// ============================================================
// App.tsx 에서 교체할 handleRunCalculation 함수
// import 에 interpolateD, calculateGrd 추가 필요:
//   import { runAll, InputData, formatSedimentInput,
//            formatSingleFormulaOutput, formatSedimentOutput,
//            interpolateD, calculateGrd } from './services/sedimentLogic';
// ============================================================

const handleRunCalculation = async () => {
  setSystemStatus('Running');
  await new Promise(resolve => setTimeout(resolve, 100));

  const zip = new JSZip();
  const inputsFolder  = zip.folder('inputs');
  const outputsFolder = zip.folder('outputs');

  // ── 공식별 폴더 생성 ──────────────────────────────────────
  const formulaFolderNames = [
    'Einstein', 'Colby', 'Engelund_Hansen', 'Toffaleti',
    'Shen_Hung', 'Ackers_White', 'Yang', 'Ranga_Raju', 'van_Rijn'
  ];
  const formulaFolders: Record<string, ReturnType<typeof zip.folder>> = {};
  formulaFolderNames.forEach(name => {
    formulaFolders[name] = outputsFolder!.folder(name);
  });

  const summaryLines: string[] = [];
  const resultsData: any[]     = [];

  summaryLines.push('============================================================');
  summaryLines.push('하천 유사량 산정 결과 요약 보고서');
  summaryLines.push(`산정 일시: ${new Date().toLocaleString()}`);
  summaryLines.push('============================================================\n');

  // ── 통과율 헤더 파싱 ─────────────────────────────────────
  const pArr = percentages.map(p => parseFloat(p));

  // ── HEC-RAS 유효 행 ──────────────────────────────────────
  // (riverSta, qTotal 모두 있는 행만)
  const validHec = hecRasRows.filter(h => h.riverSta?.trim() && h.qTotal?.trim());

  // ── 하상재료 측점별 루프 ──────────────────────────────────
  for (const bRow of bedRows) {
    const sta = bRow.station?.trim();
    if (!sta) continue;

    // 이 측점에 해당하는 HEC-RAS 행만 필터
    const hecForSta = validHec.filter(h => h.riverSta === sta);
    if (hecForSta.length === 0) continue;   // HEC-RAS에 없는 측점 → 건너뜀

    // ── 입경값 파싱 ──────────────────────────────────────
    const vArr = bRow.values.map(v => parseFloat(v));

    // ── D35/D50/D65/D90 보간 ─────────────────────────────
    const D35 = interpolateD(35, pArr, vArr) ?? interpolateD(30, pArr, vArr) ?? 0.5;
    const D50 = interpolateD(50, pArr, vArr) ?? 1.0;
    const D65 = interpolateD(65, pArr, vArr) ?? interpolateD(70, pArr, vArr) ?? 1.5;
    const D90 = interpolateD(90, pArr, vArr) ?? interpolateD(84, pArr, vArr) ?? 3.0;

    // ── Grd 계산: ((D84/D50)+(D50/D16))/2 ───────────────
    const Grd = calculateGrd(pArr, vArr);

    // ── Im[8] 가져오기 ────────────────────────────────────
    const mRow = manualDistRows.find(m => m.station === sta);
    const Im   = mRow ? mRow.values.map(v => parseFloat(v) || 0) : Array(8).fill(0);
    const hasIm = Im.some(v => v > 0);

    // ── 유량별 루프 ───────────────────────────────────────
    for (const hRow of hecForSta) {
      const wsElev  = parseFloat(hRow.wsElev);
      const minChEl = parseFloat(hRow.minChEl);
      const depth   = wsElev - minChEl;
      const Q       = parseFloat(hRow.qTotal);
      const S       = parseFloat(hRow.egSlope);
      const B       = parseFloat(hRow.topWidth);
      const Sg      = parseFloat(bRow.gravity) || 2.65;

      // 필수값 유효성 검사
      if ([depth, Q, S, B].some(v => isNaN(v) || v <= 0)) continue;

      // 파일명: 측점_프로파일  (특수문자 치환)
      const profile  = hRow.profile?.trim() || `Q${Q}`;
      const fileBase = `${sta}_${profile}`.replace(/[\/\\:*?"<>| ]/g, '_');

      const input: InputData = {
        Title   : `${sta}_${profile}`,
        IUnit   : 0,                          // SI 고정
        ISize   : hasIm ? 1 : 0,
        ISide   : parseInt(globalSettings.isSide),
        B,
        D       : depth,
        Q,
        S,
        T       : parseFloat(globalSettings.temp),
        Bedform : globalSettings.bedform,
        D35,
        D50,
        D65,
        D90,
        Sg,
        Grd,
        Delta   : parseFloat(globalSettings.delta),
        Im,
      };

      // ── 인풋파일 저장 (.dat) ──────────────────────────
      inputsFolder?.file(`${fileBase}.dat`, formatSedimentInput(input));

      // ── 계산 실행 ─────────────────────────────────────
      try {
        const results = runAll(input);
        resultsData.push({ station: sta, profile, Q, input, results });

        // 공식별 아웃풋 저장 (.out)
        const formulaKeyMap: Record<string, string> = { Rijn: 'van_Rijn' };
        Object.entries(results).forEach(([key, res]) => {
          const folderKey = formulaKeyMap[key] ?? key;
          formulaFolders[folderKey]?.file(
            `${fileBase}.out`,
            formatSingleFormulaOutput(input, key, res)
          );
        });

        // 요약 추가
        summaryLines.push(
          `[${input.Title}]  B=${B.toFixed(2)}m  D=${depth.toFixed(2)}m` +
          `  Q=${Q}m³/s  S=${S.toExponential(3)}`
        );
        Object.entries(results).forEach(([name, res]: [string, any]) => {
          if (!res || res.error) {
            summaryLines.push(`  - ${name.padEnd(16)}: 오류 - ${res?.error ?? ''}`);
            return;
          }
          if (name === 'Yang') {
            summaryLines.push(`  - Yang(1973)      : ${(res.Yang1973?.Qt_total_day ?? 0).toFixed(2).padStart(12)} ton/day`);
            summaryLines.push(`  - Yang(1979)      : ${(res.Yang1979?.Qt_total_day ?? 0).toFixed(2).padStart(12)} ton/day`);
          } else {
            summaryLines.push(`  - ${name.padEnd(16)}: ${(res.Qt_total_day ?? 0).toFixed(2).padStart(12)} ton/day`);
          }
        });
        summaryLines.push('');

      } catch (err) {
        summaryLines.push(`[${input.Title}] 계산 오류: ${err}\n`);
      }
    }
  }

  // ── 최종 파일 생성 & 다운로드 ────────────────────────────
  setSystemStatus('Summarizing');
  await new Promise(resolve => setTimeout(resolve, 300));

  zip.file('Summary_Report.txt', summaryLines.join('\n'));

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'Sediment_Results.zip');

  setCalculationResults(resultsData);
  setSystemStatus('Ready');
  setActiveStep('results');
};
