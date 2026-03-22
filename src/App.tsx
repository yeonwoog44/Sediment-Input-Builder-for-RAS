import { useState, useRef, useEffect, ClipboardEvent } from 'react';
import { 
  LayoutDashboard, 
  Database, 
  Waves, 
  Calculator, 
  Play, 
  FileText, 
  BarChart3, 
  Settings,
  ChevronRight,
  Info,
  Plus,
  Minus,
  ClipboardPaste,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { runAll, InputData, formatSedimentInput, formatSedimentOutput, formatSingleFormulaOutput } from './services/sedimentLogic';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';

type Step = 'riverbed' | 'hecras' | 'discharge' | 'conditions' | 'results';

interface NavGroup {
  title: string;
  items: {
    id: Step;
    label: string;
    icon: any;
  }[];
}

interface BedMaterialRow {
  id: string;
  station: string;
  values: string[];
  gravity: string;
}

interface ManualDistRow {
  id: string;
  station: string;
  values: string[]; // 8 fixed ranges
  formula?: string; // For verification
}

interface HecRasRow {
  reach: string;
  riverSta: string;
  profile: string;
  qTotal: string;
  minChEl: string;
  wsElev: string;
  critWs: string;
  egElev: string;
  egSlope: string;
  velChnl: string;
  flowArea: string;
  topWidth: string;
  froude: string;
}

export default function App() {
  const [activeStep, setActiveStep] = useState<Step>('riverbed');
  const [systemStatus, setSystemStatus] = useState<'Ready' | 'Running' | 'Summarizing'>('Ready');
  const [calculationResults, setCalculationResults] = useState<any[]>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [globalSettings, setGlobalSettings] = useState({
    temp: '15.0',
    bedform: 'WAVE',
    isSide: '0',
    delta: '1.0'
  });

  // Initial States for Reset
  const initialPercentages = ['5', '15', '25', '35', '45', '50', '55', '65', '75', '85', '95'];
  const initialBedRows = [{ id: '01', station: 'No. 0', values: Array(11).fill(''), gravity: '2.65' }];
  const initialHecRasRows = Array.from({ length: 10 }, () => ({
    reach: '', riverSta: '', profile: '', qTotal: '', minChEl: '',
    wsElev: '', critWs: '', egElev: '', egSlope: '', velChnl: '', flowArea: '',
    topWidth: '', froude: ''
  }));

  // Bed Material State
  const [percentages, setPercentages] = useState(initialPercentages);
  const [bedRows, setBedRows] = useState<BedMaterialRow[]>(initialBedRows);
  const [distributionMode, setDistributionMode] = useState<'auto' | 'manual'>('auto');
  const [manualDistRows, setManualDistRows] = useState<ManualDistRow[]>(
    initialBedRows.map(row => ({ id: row.id, station: row.station, values: Array(8).fill(''), formula: '' }))
  );

  // HEC-RAS State
  const [hecRasRows, setHecRasRows] = useState<HecRasRow[]>(initialHecRasRows);

  const handleReset = () => {
    if (activeStep === 'riverbed') {
      setPercentages(initialPercentages);
      setBedRows(initialBedRows);
    } else if (activeStep === 'hecras') {
      setHecRasRows(initialHecRasRows);
    }
    // Add other steps reset logic here as they are implemented
    setShowResetConfirm(false);
  };

  // Selection State
  const [selection, setSelection] = useState<{ start: { r: number, c: number }, end: { r: number, c: number } } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePercentageChange = (index: number, value: string) => {
    const newPercentages = [...percentages];
    newPercentages[index] = value;
    setPercentages(newPercentages);
    
    if (distributionMode === 'auto') {
      const newManualRows = manualDistRows.map((mRow, idx) => {
        const { values, formula } = calculateAutoDistForRow(bedRows[idx], newPercentages);
        return { ...mRow, values, formula };
      });
      setManualDistRows(newManualRows);
    }
  };

  const handleCellChange = (rowIndex: number, field: keyof BedMaterialRow | number, value: string) => {
    const newRows = [...bedRows];
    const newManualRows = [...manualDistRows];
    
    if (typeof field === 'number') {
      newRows[rowIndex].values[field] = value;
    } else {
      (newRows[rowIndex][field] as string) = value;
      if (field === 'id' || field === 'station') {
        newManualRows[rowIndex] = { ...newManualRows[rowIndex], [field]: value };
      }
    }
    
    setBedRows(newRows);

    // Auto calculate distribution if in auto mode
    if (distributionMode === 'auto') {
      const { values, formula } = calculateAutoDistForRow(newRows[rowIndex]);
      newManualRows[rowIndex] = { ...newManualRows[rowIndex], values, formula };
    }
    
    setManualDistRows(newManualRows);
  };

  const calculateAutoDistForRow = (row: BedMaterialRow, customPercentages?: string[]) => {
    const dataPoints: { x: number, y: number }[] = [];
    const pArr = customPercentages || percentages;
    
    // Independent variable (x): Grain size from table
    // Dependent variable (y): Percentage from header
    row.values.forEach((val, idx) => {
      const d = parseFloat(val);
      const p = parseFloat(pArr[idx]);
      if (!isNaN(d) && !isNaN(p) && d > 0) {
        dataPoints.push({ x: Math.log(d), y: p });
      }
    });

    if (dataPoints.length < 2) return { values: Array(8).fill(''), formula: '' };

    // Linear Regression on log scale: P = A * ln(d) + B
    const n = dataPoints.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    dataPoints.forEach(pt => {
      sumX += pt.x;
      sumY += pt.y;
      sumXY += pt.x * pt.y;
      sumX2 += pt.x * pt.x;
    });

    const denominator = (n * sumX2 - sumX * sumX);
    if (Math.abs(denominator) < 1e-10) return { values: Array(8).fill(''), formula: '' };

    const A = (n * sumXY - sumX * sumY) / denominator;
    const B = (sumY - A * sumX) / n;

    const formula = `P = ${A.toFixed(3)}ln(d) ${B >= 0 ? '+' : '-'} ${Math.abs(B).toFixed(3)}`;

    const getP = (d: number) => {
      const p = A * Math.log(d) + B;
      return Math.max(0, Math.min(100, p));
    };

    const boundaries = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];
    const results: string[] = [];
    
    let prevP = 0;
    boundaries.forEach((d) => {
      const currentP = getP(d);
      const fraction = (currentP - prevP) / 100;
      results.push(Math.max(0, fraction).toFixed(4));
      prevP = currentP;
    });

    return { values: results, formula };
  };

  // Recalculate all rows when switching to auto mode
  useEffect(() => {
    if (distributionMode === 'auto') {
      const newManualRows = manualDistRows.map((mRow, idx) => {
        const { values, formula } = calculateAutoDistForRow(bedRows[idx]);
        return { ...mRow, values, formula };
      });
      setManualDistRows(newManualRows);
    }
  }, [distributionMode]);

  const handleManualDistCellChange = (rowIndex: number, colIndex: number, value: string) => {
    const newRows = [...manualDistRows];
    newRows[rowIndex].values[colIndex] = value;
    setManualDistRows(newRows);
  };

  const handleHecRasCellChange = (rowIndex: number, field: keyof HecRasRow, value: string) => {
    const newRows = [...hecRasRows];
    newRows[rowIndex][field] = value;
    setHecRasRows(newRows);
  };

  const adjustRowCount = (count: number) => {
    if (count < 1) return;
    if (count > bedRows.length) {
      const extraCount = count - bedRows.length;
      const additionalRows = Array.from({ length: extraCount }, (_, i) => ({
        id: String(bedRows.length + i + 1).padStart(2, '0'),
        station: `No. ${bedRows.length + i}`,
        values: Array(percentages.length).fill(''),
        gravity: '2.65'
      }));
      const additionalManualRows = Array.from({ length: extraCount }, (_, i) => ({
        id: String(bedRows.length + i + 1).padStart(2, '0'),
        station: `No. ${bedRows.length + i}`,
        values: Array(8).fill('')
      }));
      setBedRows([...bedRows, ...additionalRows]);
      setManualDistRows([...manualDistRows, ...additionalManualRows]);
    } else {
      setBedRows(bedRows.slice(0, count));
      setManualDistRows(manualDistRows.slice(0, count));
    }
  };

  const adjustColCount = (count: number) => {
    if (count < 1) return;
    if (count > percentages.length) {
      const additionalCols = Array.from({ length: count - percentages.length }, () => '');
      setPercentages([...percentages, ...additionalCols]);
      setBedRows(bedRows.map(row => ({
        ...row,
        values: [...row.values, ...Array(count - row.values.length).fill('')]
      })));
    } else {
      setPercentages(percentages.slice(0, count));
      setBedRows(bedRows.map(row => ({
        ...row,
        values: row.values.slice(0, count)
      })));
    }
  };

  const stripUnits = (val: string) => {
    // Remove common HEC-RAS units: m3/s, m2, m/m, m/s, m
    // We use a regex that looks for these units specifically at the end of the string or as standalone
    return val.replace(/(m3\/s|m2|m\/m|m\/s|m)$|^\s*m\s*$/gi, '').trim();
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text');
    const rows = pasteData.split(/\r?\n/).filter(row => row.trim() !== '');
    
    const startR = selection ? Math.min(selection.start.r, selection.end.r) : 0;
    const startC = selection ? Math.min(selection.start.c, selection.end.c) : 0;

    if (activeStep === 'riverbed') {
      let rowsToPaste = [...rows];
      
      // Skip headers and unit rows (only if we are NOT pasting into the header row itself)
      if (startR !== -1) {
        while (rowsToPaste.length > 0) {
          const cells = rowsToPaste[0].split('\t').map(c => c.toLowerCase().trim());
          const isMainHeader = cells.some(cell => ['id', '측점', '비중'].includes(cell));
          const isUnitHeader = cells.some(cell => cell.startsWith('(') && cell.endsWith(')'));
          
          if (isMainHeader || isUnitHeader) {
            rowsToPaste.shift();
          } else {
            break;
          }
        }
      }

      if (rowsToPaste.length === 0) return;

      let newBedRows = [...bedRows];
      let newPercentages = [...percentages];
      let changed = false;

      rowsToPaste.forEach((rowText, rowIndex) => {
        const targetR = startR + rowIndex;
        const cells = rowText.split('\t');

        if (targetR === -1) {
          cells.forEach((cellValue, colOffset) => {
            const targetC = startC + colOffset;
            const pIdx = targetC - 2;
            if (pIdx >= 0 && pIdx < newPercentages.length) {
              newPercentages[pIdx] = cellValue.trim();
              changed = true;
            }
          });
        } else if (targetR >= 0 && targetR < newBedRows.length) {
          cells.forEach((cellValue, colOffset) => {
            const targetC = startC + colOffset;
            if (targetC === 0) newBedRows[targetR].id = cellValue.trim();
            else if (targetC === 1) newBedRows[targetR].station = cellValue.trim();
            else if (targetC >= 2 && targetC < 2 + newBedRows[targetR].values.length) {
              newBedRows[targetR].values[targetC - 2] = cellValue.trim();
            }
            else if (targetC === 2 + newBedRows[targetR].values.length) {
              newBedRows[targetR].gravity = cellValue.trim();
            }
          });
          changed = true;
        }
      });

      if (changed) {
        setBedRows(newBedRows);
        setPercentages(newPercentages);
        
        // Recalculate manual dist rows
        const newManualRows = manualDistRows.map((mRow, idx) => {
          const bRow = newBedRows[idx];
          const base = { ...mRow, id: bRow.id, station: bRow.station };
          if (distributionMode === 'auto') {
            const { values, formula } = calculateAutoDistForRow(bRow, newPercentages);
            return { ...base, values, formula };
          }
          return base;
        });
        setManualDistRows(newManualRows);
      }
    } else if (activeStep === 'hecras') {
      let rowsToPaste = [...rows];
      
      // Skip headers and unit rows
      while (rowsToPaste.length > 0) {
        const cells = rowsToPaste[0].split('\t').map(c => c.toLowerCase().trim());
        const isMainHeader = cells.some(cell => ['reach', 'river sta', 'profile', 'q total'].includes(cell));
        const isUnitHeader = cells.some(cell => cell.startsWith('(') && cell.endsWith(')'));
        
        if (isMainHeader || isUnitHeader) {
          rowsToPaste.shift();
        } else {
          break;
        }
      }

      if (rowsToPaste.length === 0) return;

      const requiredRows = startR + rowsToPaste.length;
      let newHecRasRows = [...hecRasRows];
      
      if (requiredRows > newHecRasRows.length) {
        const extraRowsCount = requiredRows - newHecRasRows.length;
        const extraRows = Array.from({ length: extraRowsCount }, () => ({
          reach: '', riverSta: '', profile: '', qTotal: '', minChEl: '',
          wsElev: '', critWs: '', egElev: '', egSlope: '', velChnl: '', flowArea: '',
          topWidth: '', froude: ''
        }));
        newHecRasRows = [...newHecRasRows, ...extraRows];
      }

      const fields: (keyof HecRasRow)[] = [
        'reach', 'riverSta', 'profile', 'qTotal', 'minChEl', 
        'wsElev', 'critWs', 'egElev', 'egSlope', 'velChnl', 'flowArea', 
        'topWidth', 'froude'
      ];
      
      rowsToPaste.forEach((rowText, rowIndex) => {
        const targetR = startR + rowIndex;
        const cells = rowText.split('\t');
        cells.forEach((cellValue, colOffset) => {
          const targetC = startC + colOffset;
          if (targetC < fields.length) {
            newHecRasRows[targetR][fields[targetC]] = stripUnits(cellValue);
          }
        });
      });
      setHecRasRows(newHecRasRows);
    }
  };

  const handleMouseDown = (r: number, c: number) => {
    setSelection({ start: { r, c }, end: { r, c } });
    setIsDragging(true);
  };

  const handleMouseEnter = (r: number, c: number) => {
    if (isDragging && selection) {
      setSelection({ ...selection, end: { r, c } });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const isSelected = (r: number, c: number) => {
    if (!selection) return false;
    const minR = Math.min(selection.start.r, selection.end.r);
    const maxR = Math.max(selection.start.r, selection.end.r);
    const minC = Math.min(selection.start.c, selection.end.c);
    const maxC = Math.max(selection.start.c, selection.end.c);
    return r >= minR && r <= maxR && c >= minC && c <= maxC;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        const minR = Math.min(selection.start.r, selection.end.r);
        const maxR = Math.max(selection.start.r, selection.end.r);
        const minC = Math.min(selection.start.c, selection.end.c);
        const maxC = Math.max(selection.start.c, selection.end.c);

        if (activeStep === 'riverbed') {
          const newRows = [...bedRows];
          const newPercentages = [...percentages];
          let changed = false;
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              if (r === -1) {
                const pIdx = c - 2;
                if (pIdx >= 0 && pIdx < newPercentages.length) {
                  newPercentages[pIdx] = '';
                  changed = true;
                }
              } else if (r >= 0 && r < newRows.length) {
                if (c === 0) newRows[r].id = '';
                else if (c === 1) newRows[r].station = '';
                else if (c >= 2 && c < 2 + percentages.length) newRows[r].values[c - 2] = '';
                else if (c === 2 + percentages.length) newRows[r].gravity = '';
                changed = true;
              }
            }
          }
          if (changed) {
            setBedRows(newRows);
            setPercentages(newPercentages);
          }
        } else if (activeStep === 'hecras') {
          const newRows = [...hecRasRows];
          const fields: (keyof HecRasRow)[] = [
            'reach', 'riverSta', 'profile', 'qTotal', 'minChEl', 
            'wsElev', 'critWs', 'egSlope', 'velChnl', 'flowArea', 
            'topWidth', 'froude'
          ];
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              if (c < fields.length) {
                newRows[r][fields[c]] = '';
              }
            }
          }
          setHecRasRows(newRows);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selection, bedRows, percentages.length]);

  const handleRunCalculation = async () => {
    setSystemStatus('Running');
    await new Promise(resolve => setTimeout(resolve, 100));

    const zip = new JSZip();
    const inputsFolder = zip.folder("inputs");
    const outputsFolder = zip.folder("outputs");
    
    // Create formula folders
    const formulaNames = [
      "Einstein", "Colby", "Engelund_Hansen", "Toffaleti", 
      "Shen_Hung", "Ackers_White", "Yang", "Ranga_Raju", "van_Rijn"
    ];
    const formulaFolders: Record<string, any> = {};
    formulaNames.forEach(name => {
      formulaFolders[name] = outputsFolder?.folder(name);
    });
    
    const summaryReport: string[] = [];
    const resultsData: any[] = [];
    
    summaryReport.push("============================================================");
    summaryReport.push("하천 유사량 산정 결과 요약 보고서");
    summaryReport.push(`산정 일시: ${new Date().toLocaleString()}`);
    summaryReport.push("============================================================\n");

    // Loop through each Bed Material station
    for (const bRow of bedRows) {
      if (!bRow.station) continue;

      // Find all matching HEC-RAS profiles for this station
      const matchingHecRas = hecRasRows.filter(h => h.riverSta === bRow.station);
      
      // If no match, skip or use a default? User said "match them"
      if (matchingHecRas.length === 0) continue;

      const mRow = manualDistRows.find(m => m.station === bRow.station) || manualDistRows[0];

      const getD = (targetP: number) => {
        const pArr = percentages.map(p => parseFloat(p));
        const vArr = bRow.values.map(v => parseFloat(v));
        const validPoints = pArr.map((p, i) => ({ p, v: vArr[i] }))
          .filter(pt => !isNaN(pt.p) && !isNaN(pt.v));
        if (validPoints.length < 2) return 0.5;
        for (let i = 0; i < validPoints.length - 1; i++) {
          if (targetP >= validPoints[i].p && targetP <= validPoints[i+1].p) {
            const ratio = (targetP - validPoints[i].p) / (validPoints[i+1].p - validPoints[i].p);
            return validPoints[i].v + ratio * (validPoints[i+1].v - validPoints[i].v);
          }
        }
        if (targetP < validPoints[0].p) return validPoints[0].v;
        return validPoints[validPoints.length - 1].v;
      };

      for (const hRow of matchingHecRas) {
        if (!hRow.qTotal) continue;

        const depth = parseFloat(hRow.wsElev) - parseFloat(hRow.minChEl);
        const fileId = bRow.id || bRow.station;
        const fileName = `${fileId}_${hRow.qTotal}`;

        const input: InputData = {
          Title: fileName,
          IUnit: 0, // SI
          ISize: 1,
          ISide: parseInt(globalSettings.isSide),
          B: parseFloat(hRow.topWidth) || 1,
          D: isNaN(depth) || depth <= 0 ? 0.001 : depth,
          Q: parseFloat(hRow.qTotal) || 0,
          S: parseFloat(hRow.egSlope) || 0.001,
          T: parseFloat(globalSettings.temp),
          Bedform: globalSettings.bedform,
          D35: getD(35),
          D50: getD(50),
          D65: getD(65),
          D90: getD(90),
          Sg: parseFloat(bRow.gravity) || 2.65,
          Grd: 1.0,
          Delta: parseFloat(globalSettings.delta),
          Im: mRow.values.map(v => parseFloat(v) || 0)
        };

        try {
          const results = runAll(input);
          resultsData.push({ station: hRow.riverSta, q: hRow.qTotal, results });

          // 1. Generate Input File (.dat)
          const inputStr = formatSedimentInput(input);
          inputsFolder?.file(`${fileName}.dat`, inputStr);

          // 2. Generate Individual Output Files by Formula (.out)
          Object.entries(results).forEach(([key, res]) => {
            // Map logic key to folder name
            let folderName = key;
            if (key === 'Engelund_Hansen') folderName = "Engelund_Hansen";
            if (key === 'Shen_Hung') folderName = "Shen_Hung";
            if (key === 'Ackers_White') folderName = "Ackers_White";
            if (key === 'Rijn') folderName = "van_Rijn";
            if (key === 'Ranga_Raju') folderName = "Ranga_Raju";

            const folder = formulaFolders[folderName];
            if (folder) {
              const outputStr = formatSingleFormulaOutput(input, folderName, res);
              folder.file(`${fileName}.out`, outputStr);
            }
          });

          // 3. Add to Summary
          summaryReport.push(`[ID: ${fileId}] (Q=${hRow.qTotal} m3/s, D=${depth.toFixed(2)}m, S=${hRow.egSlope})`);
          Object.entries(results).forEach(([name, res]: [string, any]) => {
            if (res && !res.error) {
              const qt = res.Qt_total_day || (res.Yang1973 ? res.Yang1973.Qt_total_day : 0);
              summaryReport.push(`  - ${name.padEnd(15)}: ${qt.toFixed(2).padStart(10)} ton/day`);
            }
          });
          summaryReport.push("");

        } catch (err) {
          summaryReport.push(`[ID: ${fileId}] Calculation Error: ${err}\n`);
        }
      }
    }

    setSystemStatus('Summarizing');
    await new Promise(resolve => setTimeout(resolve, 500));

    zip.file("Summary_Report.txt", summaryReport.join('\n'));
    
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "Sediment_Results_All.zip");

    setCalculationResults(resultsData);
    setSystemStatus('Ready');
    setActiveStep('results');
  };

  const navGroups: NavGroup[] = [
    {
      title: "1. 유사량산정",
      items: [
        { id: 'riverbed', label: '하상재료 입력', icon: Database },
        { id: 'hecras', label: 'HEC-RAS 결과 입력', icon: Waves },
      ]
    },
    {
      title: "2. 하상변동 입력자료",
      items: [
        { id: 'discharge', label: '유량자료 입력', icon: FileText },
        { id: 'conditions', label: '분석조건 입력', icon: Settings },
      ]
    },
    {
      title: "3. 산정 결과",
      items: [
        { id: 'results', label: '산정 결과 요약', icon: BarChart3 },
      ]
    }
  ];

  const allSteps = navGroups.flatMap(group => group.items);

  return (
    <div className="flex h-screen bg-[#E4E3E0] text-[#141414] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 border-r border-[#141414] flex flex-col bg-[#E4E3E0]">
        <div className="p-6 border-b border-[#141414] relative">
          <h1 className="text-base font-bold tracking-tight leading-tight">Sediment Input Builder for RAS</h1>
          <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] uppercase tracking-widest opacity-50">v1.0 26.03.21</p>
            <div 
              className="relative"
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
            >
              <Info size={14} className="cursor-help opacity-40 hover:opacity-100 transition-opacity" />
              <AnimatePresence>
                {showInfo && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 5 }}
                    className="absolute left-full ml-2 top-0 w-48 bg-[#141414] text-[#E4E3E0] p-4 shadow-xl z-50 border border-[#E4E3E0]/20"
                  >
                    <div className="text-[10px] uppercase tracking-widest opacity-50 mb-2 border-b border-[#E4E3E0]/10 pb-1">Developer Info</div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[9px] opacity-40 uppercase">Name</div>
                        <div className="text-xs font-medium">김연욱</div>
                      </div>
                      <div>
                        <div className="text-[9px] opacity-40 uppercase">Contact</div>
                        <div className="text-xs font-medium">ywk@kunhwaeng.co.kr</div>
                        <div className="text-xs font-medium">010-7553-5289</div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          {navGroups.map((group, groupIndex) => (
            <div key={group.title} className="mb-10 px-6">
              <h3 className="text-sm font-bold uppercase tracking-tight text-[#141414] mb-4">
                {group.title}
              </h3>
              <div className="space-y-1 -mx-6">
                {group.items.map((step, index) => {
                  const Icon = step.icon;
                  const isActive = activeStep === step.id;
                  return (
                    <button
                      key={step.id}
                      onClick={() => setActiveStep(step.id)}
                      className={`w-full flex items-center gap-4 px-6 py-3 text-left transition-all duration-200 group ${
                        isActive ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'
                      }`}
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium">{step.label}</div>
                      </div>
                      {isActive && <ChevronRight size={14} />}
                    </button>
                  );
                })}
              </div>
              
              {/* Run Button for each group */}
              <button 
                className="mt-4 w-full py-2.5 border border-[#141414] flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-[#141414] hover:text-[#E4E3E0] transition-all group"
                onClick={() => {
                  if (groupIndex === 0) {
                    setShowRunModal(true);
                  } else {
                    alert(`${group.title} 분석을 시작합니다.`);
                  }
                }}
              >
                <Play size={12} className="group-hover:fill-current" />
                {groupIndex === 0 ? '유사량 산정 실행' : '하상변동 입력자료 생성'}
              </button>
            </div>
          ))}
        </nav>

        <div className="p-6 border-t border-[#141414] bg-[#141414]/5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
            <div className={`w-2 h-2 rounded-full ${systemStatus === 'Ready' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="opacity-50">System Status:</span>
            <span className="font-bold">{systemStatus}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-[#141414] flex items-center justify-between px-8 bg-[#E4E3E0]">
          <div className="flex items-center gap-4">
            <LayoutDashboard size={20} />
            <h2 className="text-sm font-medium uppercase tracking-widest">
              {allSteps.find(s => s.id === activeStep)?.label}
            </h2>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => setShowResetConfirm(true)}
              className="px-4 py-1.5 border border-[#141414] text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
            >
              데이터 초기화
            </button>
            <button className="px-4 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#141414]/80 transition-colors">
              프로젝트 저장
            </button>
          </div>
        </header>

        {/* Reset Confirmation Modal */}
        <AnimatePresence>
          {showResetConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowResetConfirm(false)}
                className="absolute inset-0 bg-[#141414]/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-[#E4E3E0] border border-[#141414] p-8 max-w-sm w-full shadow-2xl"
              >
                <h3 className="text-lg font-bold mb-2">데이터 초기화</h3>
                <p className="text-sm opacity-70 mb-8 leading-relaxed">
                  현재 화면({allSteps.find(s => s.id === activeStep)?.label})의<br/>
                  데이터를 초기화하시겠습니까?<br/>
                  이 작업은 되돌릴 수 없습니다.
                </p>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowResetConfirm(false)}
                    className="flex-1 py-3 border border-[#141414] text-[10px] font-bold uppercase tracking-widest hover:bg-[#141414]/5 transition-colors"
                  >
                    아니요
                  </button>
                  <button 
                    onClick={handleReset}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-widest hover:bg-[#141414]/90 transition-colors"
                  >
                    예 (초기화)
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Run Modal (Global Settings) */}
        <AnimatePresence>
          {showRunModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowRunModal(false)}
                className="absolute inset-0 bg-[#141414]/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-[#E4E3E0] border border-[#141414] p-8 max-w-md w-full shadow-2xl"
              >
                <div className="flex items-center gap-3 mb-6">
                  <Play size={20} className="fill-[#141414]" />
                  <h3 className="text-lg font-bold uppercase tracking-widest">유사량 산정 실행</h3>
                </div>

                <div className="space-y-6 mb-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase font-bold opacity-50">수온 (℃)</label>
                      <input 
                        type="text" 
                        value={globalSettings.temp} 
                        onChange={(e) => setGlobalSettings({...globalSettings, temp: e.target.value})}
                        className="w-full bg-transparent border-b border-[#141414] text-sm font-bold focus:outline-none p-1" 
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase font-bold opacity-50">하상형태 (Bedform)</label>
                      <select 
                        value={globalSettings.bedform} 
                        onChange={(e) => setGlobalSettings({...globalSettings, bedform: e.target.value})}
                        className="w-full bg-transparent border-b border-[#141414] text-sm font-bold focus:outline-none p-1"
                      >
                        <option value="WAVE">WAVE</option>
                        <option value="FLAT">FLAT</option>
                        <option value="DUNE">DUNE</option>
                        <option value="RIPPLE">RIPPLE</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase font-bold opacity-50">측벽보정 (ISide)</label>
                      <select 
                        value={globalSettings.isSide} 
                        onChange={(e) => setGlobalSettings({...globalSettings, isSide: e.target.value})}
                        className="w-full bg-transparent border-b border-[#141414] text-sm font-bold focus:outline-none p-1"
                      >
                        <option value="0">0: 미적용</option>
                        <option value="1">1: 적용</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase font-bold opacity-50">사구높이 (Delta, m)</label>
                      <input 
                        type="text" 
                        value={globalSettings.delta} 
                        onChange={(e) => setGlobalSettings({...globalSettings, delta: e.target.value})}
                        className="w-full bg-transparent border-b border-[#141414] text-sm font-bold focus:outline-none p-1" 
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowRunModal(false)}
                    className="flex-1 py-3 border border-[#141414] text-[10px] font-bold uppercase tracking-widest hover:bg-[#141414]/5 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    onClick={() => {
                      handleRunCalculation();
                      setShowRunModal(false);
                    }}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-widest hover:bg-[#141414]/90 transition-colors flex items-center justify-center gap-2"
                  >
                    <Play size={12} fill="currentColor" />
                    산정 실행
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto p-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStep}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              {activeStep === 'riverbed' && (
                <div className="space-y-8">
                  <section>
                    <div className="flex items-center justify-between mb-6 gap-6">
                      <div className="flex items-baseline gap-3">
                        <h3 className="text-lg font-bold uppercase tracking-widest text-[#141414]">하상재료 시험결과 입력</h3>
                      </div>

                      <div className="flex gap-4 bg-white/50 border border-[#141414] p-2 px-4">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] uppercase font-bold opacity-50">입도분포</label>
                          <div className="flex gap-3 h-full items-center">
                            <label className="flex items-center gap-1.5 cursor-pointer group">
                              <input 
                                type="radio" 
                                name="distMode" 
                                checked={distributionMode === 'auto'} 
                                onChange={() => setDistributionMode('auto')}
                                className="hidden"
                              />
                              <div className={`w-2.5 h-2.5 rounded-full border border-[#141414] flex items-center justify-center ${distributionMode === 'auto' ? 'bg-[#141414]' : ''}`}>
                                {distributionMode === 'auto' && <div className="w-1 h-1 bg-white rounded-full" />}
                              </div>
                              <span className={`text-[10px] font-bold ${distributionMode === 'auto' ? 'opacity-100' : 'opacity-40'}`}>자동</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer group">
                              <input 
                                type="radio" 
                                name="distMode" 
                                checked={distributionMode === 'manual'} 
                                onChange={() => setDistributionMode('manual')}
                                className="hidden"
                              />
                              <div className={`w-2.5 h-2.5 rounded-full border border-[#141414] flex items-center justify-center ${distributionMode === 'manual' ? 'bg-[#141414]' : ''}`}>
                                {distributionMode === 'manual' && <div className="w-1 h-1 bg-white rounded-full" />}
                              </div>
                              <span className={`text-[10px] font-bold ${distributionMode === 'manual' ? 'opacity-100' : 'opacity-40'}`}>수동</span>
                            </label>
                          </div>
                        </div>

                        <div className="w-px bg-[#141414]/10" />

                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] uppercase font-bold opacity-50">측점수</label>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => adjustRowCount(bedRows.length - 1)} className="p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors border border-[#141414]">
                              <Minus size={10} />
                            </button>
                            <input 
                              type="number" 
                              value={bedRows.length} 
                              onChange={(e) => adjustRowCount(parseInt(e.target.value) || 1)}
                              className="w-8 text-center bg-transparent border-b border-[#141414] text-[10px] font-bold focus:outline-none" 
                            />
                            <button onClick={() => adjustRowCount(bedRows.length + 1)} className="p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors border border-[#141414]">
                              <Plus size={10} />
                            </button>
                          </div>
                        </div>

                        <div className="w-px bg-[#141414]/10" />

                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] uppercase font-bold opacity-50">평균입경수</label>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => adjustColCount(percentages.length - 1)} className="p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors border border-[#141414]">
                              <Minus size={10} />
                            </button>
                            <input 
                              type="number" 
                              value={percentages.length} 
                              onChange={(e) => adjustColCount(parseInt(e.target.value) || 1)}
                              className="w-8 text-center bg-transparent border-b border-[#141414] text-[10px] font-bold focus:outline-none" 
                            />
                            <button onClick={() => adjustColCount(percentages.length + 1)} className="p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors border border-[#141414]">
                              <Plus size={10} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border border-[#141414] bg-white overflow-auto max-h-[60vh] select-none" onPaste={handlePaste}>
                      <table className="text-left text-[11px] border-collapse min-w-max">
                        <thead className="bg-[#141414] text-[#E4E3E0] font-mono uppercase tracking-tight text-center sticky top-0 z-10">
                          <tr>
                            <th rowSpan={2} className="p-2 border-r border-[#E4E3E0]/20 w-[60px] min-w-[60px]">ID</th>
                            <th rowSpan={2} className="p-2 border-r border-[#E4E3E0]/20 w-[60px] min-w-[60px]">측점 (STA.NO.)</th>
                            <th colSpan={percentages.length} className="p-2 border-b border-[#E4E3E0]/20 whitespace-normal break-all">
                              통과중량 백분율에 대한 평균입경(<span className="lowercase text-white">mm</span>, 숫자만 입력)
                            </th>
                            <th rowSpan={2} className="p-2 w-[60px] min-w-[60px]">비중</th>
                          </tr>
                          <tr>
                            {percentages.map((p, i) => (
                              <th 
                                key={i} 
                                className={`p-1 border-r border-[#E4E3E0]/20 bg-[#141414]/90 w-[60px] min-w-[60px] ${isSelected(-1, i + 2) ? 'bg-blue-800' : ''}`}
                                onMouseDown={() => handleMouseDown(-1, i + 2)}
                                onMouseEnter={() => handleMouseEnter(-1, i + 2)}
                              >
                                <input 
                                  type="text" 
                                  value={p} 
                                  onChange={(e) => handlePercentageChange(i, e.target.value)}
                                  className="w-full bg-transparent text-center focus:outline-none text-[#E4E3E0]"
                                />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {bedRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-b border-[#141414]/10">
                              <td 
                                className={`p-0 border-r border-[#141414]/10 w-[60px] ${isSelected(rowIndex, 0) ? 'bg-blue-100' : ''}`}
                                onMouseDown={() => handleMouseDown(rowIndex, 0)}
                                onMouseEnter={() => handleMouseEnter(rowIndex, 0)}
                              >
                                <input 
                                  type="text" 
                                  value={row.id} 
                                  onChange={(e) => handleCellChange(rowIndex, 'id', e.target.value)}
                                  className="w-full h-full p-2 bg-transparent focus:outline-none text-center"
                                />
                              </td>
                              <td 
                                className={`p-0 border-r border-[#141414]/10 w-[60px] ${isSelected(rowIndex, 1) ? 'bg-blue-100' : ''}`}
                                onMouseDown={() => handleMouseDown(rowIndex, 1)}
                                onMouseEnter={() => handleMouseEnter(rowIndex, 1)}
                              >
                                <input 
                                  type="text" 
                                  value={row.station} 
                                  onChange={(e) => handleCellChange(rowIndex, 'station', e.target.value)}
                                  className="w-full h-full p-2 bg-transparent focus:outline-none text-center"
                                />
                              </td>
                              {row.values.map((val, colIndex) => (
                                <td 
                                  key={colIndex} 
                                  className={`p-0 border-r border-[#141414]/10 w-[60px] ${isSelected(rowIndex, colIndex + 2) ? 'bg-blue-100' : ''}`}
                                  onMouseDown={() => handleMouseDown(rowIndex, colIndex + 2)}
                                  onMouseEnter={() => handleMouseEnter(rowIndex, colIndex + 2)}
                                >
                                  <input 
                                    type="text" 
                                    value={val} 
                                    onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                    className="w-full h-full p-2 bg-transparent text-center focus:outline-none"
                                  />
                                </td>
                              ))}
                              <td 
                                className={`p-0 w-[60px] ${isSelected(rowIndex, 2 + percentages.length) ? 'bg-blue-100' : ''}`}
                                onMouseDown={() => handleMouseDown(rowIndex, 2 + percentages.length)}
                                onMouseEnter={() => handleMouseEnter(rowIndex, 2 + percentages.length)}
                              >
                                <input 
                                  type="text" 
                                  value={row.gravity} 
                                  onChange={(e) => handleCellChange(rowIndex, 'gravity', e.target.value)}
                                  className="w-full h-full p-2 bg-transparent text-center focus:outline-none"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-12 space-y-4">
                      <div className="flex items-baseline gap-3">
                        <h4 className="text-sm font-bold uppercase tracking-widest text-[#141414]">입도분포 비율 입력 {distributionMode === 'auto' ? '(자동)' : '(수동)'}</h4>
                        <span className="text-[10px] opacity-50 italic">
                          {distributionMode === 'auto' 
                            ? '상단 표에 값을 입력하면 자동으로 계산됩니다.' 
                            : '8개 구간 고정 비율 (0~1 사이 값 입력)'}
                        </span>
                      </div>
                      <div className={`border border-[#141414] bg-white overflow-x-auto select-none ${distributionMode === 'auto' ? 'bg-[#141414]/5' : ''}`}>
                        <table className="text-left text-[11px] border-collapse min-w-max">
                          <thead className="bg-[#141414] text-[#E4E3E0] font-mono uppercase tracking-tight text-center sticky top-0 z-10">
                            <tr>
                              <th className="p-2 border-r border-[#E4E3E0]/20 w-[60px] min-w-[60px]">ID</th>
                              <th className="p-2 border-r border-[#E4E3E0]/20 w-[60px] min-w-[60px]">측점</th>
                              {[
                                '0.0625~0.125', '0.125~0.25', '0.25~0.5', '0.5~1',
                                '1~2', '2~4', '4~8', '8~16'
                              ].map((range, i) => (
                                <th key={i} className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">
                                  {range}
                                </th>
                              ))}
                              {distributionMode === 'auto' && (
                                <th className="p-2 border-r border-[#E4E3E0]/20 w-[150px] min-w-[150px] italic text-[9px] opacity-60">
                                  Calculated Formula<br/>(P = A ln(d) + B)
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="font-mono">
                            {manualDistRows.map((row, rowIndex) => (
                              <tr key={rowIndex} className="border-b border-[#141414]/10">
                                <td className="p-2 border-r border-[#141414]/10 w-[60px] text-center bg-[#141414]/5">{row.id}</td>
                                <td className="p-2 border-r border-[#141414]/10 w-[60px] text-center bg-[#141414]/5">{row.station}</td>
                                {row.values.map((val, colIndex) => (
                                  <td key={colIndex} className="p-0 border-r border-[#141414]/10 w-[80px]">
                                    <input 
                                      type="text" 
                                      value={val} 
                                      readOnly={distributionMode === 'auto'}
                                      placeholder={distributionMode === 'auto' ? '입력대기' : '0.0000'}
                                      onChange={(e) => handleManualDistCellChange(rowIndex, colIndex, e.target.value)}
                                      className={`w-full h-full p-2 bg-transparent focus:outline-none text-center ${distributionMode === 'auto' ? 'cursor-default opacity-60' : ''}`}
                                    />
                                  </td>
                                ))}
                                {distributionMode === 'auto' && (
                                  <td className="p-2 text-[9px] text-center opacity-50 italic bg-[#141414]/5">
                                    {row.formula || '-'}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {activeStep === 'hecras' && (
                <div className="space-y-8">
                  <section>
                    <div className="flex items-baseline gap-3 mb-6">
                      <h3 className="text-lg font-bold uppercase tracking-widest text-[#141414]">HEC-RAS 결과 입력</h3>
                      <span className="text-[11px] text-[#141414]/60 font-medium">헤더까지 복사후 노란색에 붙여넣기</span>
                    </div>
                    
                    <div className="border border-[#141414] bg-white overflow-auto max-h-[60vh] select-none" onPaste={handlePaste}>
                      <table className="text-left text-[11px] border-collapse min-w-max">
                        <thead className="bg-[#141414] text-[#E4E3E0] font-mono tracking-tight text-center sticky top-0 z-10">
                          <tr>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Reach</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">River Sta</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Profile</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Q Total<br/>(m<sup>3</sup>/s)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Min Ch El<br/>(m)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">W.S. Elev<br/>(m)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Crit W.S.<br/>(m)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">E.G. Elev<br/>(m)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">E.G. Slope<br/>(m/m)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Vel Chnl<br/>(m/s)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Flow Area<br/>(m<sup>2</sup>)</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20 w-[80px] min-w-[80px]">Top Width<br/>(m)</th>
                            <th className="p-2 w-[80px] min-w-[80px]">Froude # Chl</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {hecRasRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-b border-[#141414]/10">
                              {[
                                'reach', 'riverSta', 'profile', 'qTotal', 'minChEl', 
                                'wsElev', 'critWs', 'egElev', 'egSlope', 'velChnl', 'flowArea', 
                                'topWidth', 'froude'
                              ].map((field, colIndex) => (
                                <td 
                                  key={field}
                                  className={`p-0 border-r border-[#141414]/10 w-[80px] ${rowIndex === 0 && colIndex === 0 ? 'bg-yellow-200' : isSelected(rowIndex, colIndex) ? 'bg-blue-100' : ''}`}
                                  onMouseDown={() => handleMouseDown(rowIndex, colIndex)}
                                  onMouseEnter={() => handleMouseEnter(rowIndex, colIndex)}
                                >
                                  <input 
                                    type="text" 
                                    value={row[field as keyof HecRasRow]} 
                                    onChange={(e) => handleHecRasCellChange(rowIndex, field as keyof HecRasRow, e.target.value)}
                                    className="w-full h-full p-2 bg-transparent focus:outline-none text-center"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}

              {activeStep === 'results' && (
                <div className="space-y-8">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold uppercase tracking-widest text-[#141414]">산정 결과 요약</h3>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          const report = calculationResults.map(res => {
                            let s = `[Station: ${res.station}]\n`;
                            Object.entries(res.results).forEach(([name, val]: [string, any]) => {
                              if (val.Qt_total_day) s += `  - ${name}: ${val.Qt_total_day.toFixed(2)} ton/day\n`;
                              else if (val.Yang1973) s += `  - Yang1973: ${val.Yang1973.Qt_total_day.toFixed(2)} ton/day\n  - Yang1979: ${val.Yang1979.Qt_total_day.toFixed(2)} ton/day\n`;
                            });
                            return s;
                          }).join('\n');
                          const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
                          saveAs(blob, 'Sediment_Summary.txt');
                        }}
                        className="flex items-center gap-2 px-4 py-2 border border-[#141414] text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                      >
                        <Download size={14} />
                        요약 파일 다운로드
                      </button>
                      <button 
                        onClick={() => {
                          // The full report is already generated in handleRunCalculation, 
                          // but let's allow re-downloading it if needed.
                          // For simplicity, we'll just trigger handleRunCalculation again or store the last report.
                          // Actually, handleRunCalculation already triggers a download.
                          // Let's just make the summary download more prominent or add a specific "Full Report" button if we store it.
                          // Since we don't store the full text report string in state, let's just keep the summary for now or re-run.
                          // I'll just refine the existing button to be clearer.
                        }}
                        className="hidden"
                      >
                        Full Report
                      </button>
                    </div>
                  </div>

                  {calculationResults.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[40vh] border border-dashed border-[#141414]/20 rounded-xl">
                      <Calculator size={32} className="opacity-20 mb-4" />
                      <p className="text-sm opacity-40">아직 산정된 결과가 없습니다. '유사량 산정 실행'을 클릭하세요.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {calculationResults.map((res, idx) => (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.05 }}
                          className="bg-white border border-[#141414] p-6 shadow-sm hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-center justify-between mb-4 border-b border-[#141414]/10 pb-2">
                            <span className="text-[10px] uppercase font-bold opacity-50">Station</span>
                            <span className="text-sm font-bold">{res.station}</span>
                          </div>
                          <div className="space-y-3">
                            {Object.entries(res.results).map(([name, val]: [string, any]) => {
                              if (val.error) return null;
                              const displayVal = val.Qt_total_day || (val.Yang1973 ? val.Yang1973.Qt_total_day : null);
                              if (displayVal === null) return null;
                              
                              return (
                                <div key={name} className="flex items-center justify-between text-[11px]">
                                  <span className="opacity-60">{name.replace('_', ' ')}</span>
                                  <span className="font-mono font-bold">{Number(displayVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[9px] font-normal opacity-40">t/d</span></span>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeStep !== 'riverbed' && activeStep !== 'hecras' && activeStep !== 'results' && (
                <div className="flex flex-col items-center justify-center h-[60vh] opacity-30 text-center">
                  <Calculator size={48} className="mb-4" />
                  <h3 className="text-xl font-serif italic">준비 중인 화면입니다</h3>
                  <p className="text-sm">현재 '하상재료 입력' 단계부터 구현을 시작하고 있습니다.</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
