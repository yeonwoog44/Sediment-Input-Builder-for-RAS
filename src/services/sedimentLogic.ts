
/**
 * 하천 유사량 산정 프로그램 (9개 공식)
 * 원전: 하천유사량산정방법의선정기준개발 (KICT, 1989.12)
 * Python 변환본을 기반으로 한 TypeScript 구현
 */

// ============================================================
// 데이터 구조 정의
// ============================================================

export interface InputData {
  Title: string;
  IUnit: number;    // 0=SI, 1=English
  ISize: number;    // 0=Single, 1=Distribution
  ISide: number;    // 0=None, 1=Vanoni&Brooks
  B: number;        // Width (m)
  D: number;        // Depth (m)
  Q: number;        // Discharge (cms)
  S: number;        // Energy Slope
  T: number;        // Temperature (°C)
  Bedform: string;
  D35: number;      // mm
  D50: number;      // mm
  D65: number;      // mm
  D90: number;      // mm
  Sg: number;       // Specific Gravity
  Grd: number;      // Gradation Coefficient
  Delta: number;    // Dune height (m)
  Im: number[];     // 8 distribution ratios (0~1)
}

// ============================================================
// ★ 신규: 입경 보간 유틸리티
// ============================================================

/**
 * 선형 보간으로 특정 통과율(targetP)에 해당하는 입경(mm) 계산
 * @param targetP  목표 통과율 (예: 35, 50, 65)
 * @param pArr     헤더 통과율 배열 (예: [5, 15, 25, 45, 55, 65, 90])
 * @param vArr     입경값 배열 (mm, pArr 와 1:1 대응)
 * @returns        보간된 입경(mm), 범위 밖이면 null
 */
export function interpolateD(
  targetP: number,
  pArr: number[],
  vArr: number[]
): number | null {
  // 유효 포인트만 추출 (NaN, 0 이하 제외)
  const points: { p: number; v: number }[] = [];
  for (let i = 0; i < pArr.length; i++) {
    const p = pArr[i];
    const v = vArr[i];
    if (!isNaN(p) && !isNaN(v) && v > 0 && p > 0) {
      points.push({ p, v });
    }
  }
  if (points.length === 0) return null;

  // 통과율 오름차순 정렬
  points.sort((a, b) => a.p - b.p);

  // 정확히 일치하는 값 직접 반환
  const exact = points.find(pt => pt.p === targetP);
  if (exact) return exact.v;

  // 보간 범위 밖이면 null (외삽 안 함)
  if (targetP < points[0].p || targetP > points[points.length - 1].p) return null;

  // 선형 보간
  for (let i = 0; i < points.length - 1; i++) {
    if (targetP >= points[i].p && targetP <= points[i + 1].p) {
      const { p: p1, v: v1 } = points[i];
      const { p: p2, v: v2 } = points[i + 1];
      return v1 + (v2 - v1) / (p2 - p1) * (targetP - p1);
    }
  }
  return null;
}

/**
 * 등급계수 Grd 계산
 * Grd = ((D84/D50) + (D50/D16)) / 2
 * @param pArr  헤더 통과율 배열
 * @param vArr  입경값 배열 (mm)
 * @returns     Grd 값, 계산 불가 시 1.0 반환
 */
export function calculateGrd(pArr: number[], vArr: number[]): number {
  const D16 = interpolateD(16, pArr, vArr);
  const D50 = interpolateD(50, pArr, vArr);
  const D84 = interpolateD(84, pArr, vArr);

  if (D16 == null || D50 == null || D84 == null) return 1.0;
  if (D16 <= 0 || D50 <= 0) return 1.0;

  return ((D84 / D50) + (D50 / D16)) / 2;
}

// ============================================================
// 공통 함수들
// ============================================================

/** 동점성계수 계산 (m^2/sec) - 섭씨 온도 입력 */
export function visco(Tdc: number): number {
  return 1.785e-6 / (1.0 + 0.03368 * Tdc + 0.000221 * Math.pow(Tdc, 2));
}

/** Einstein 전이계수 x 계산 (Function SX) */
export function SX(Ksod: number): number {
  if (Ksod <= 0.4) {
    return 1.70 * Math.log10(Ksod) + 1.90;
  } else if (Ksod < 2.35) {
    return 1.615 - 1.54 * Math.pow(Math.abs(Math.log10(Ksod)), 1.6);
  } else if (Ksod < 10.0) {
    return 0.926 * Math.pow(1.0 - Math.log10(Ksod), 2.43) + 1.00;
  } else {
    return 1.00;
  }
}

/** 양력계수 수정인자 Y 계산 (Function FLift) */
export function FLift(Ksod: number): number {
  let Ycalc: number;
  if (Ksod <= 0.47) {
    Ycalc = Math.pow(Ksod, 1.187);
  } else if (Ksod <= 1.70) {
    Ycalc = Math.pow(10.0, -2.23 * Math.pow(Math.log10(Ksod) - 0.0492, 2) - 0.083);
  } else if (Ksod <= 3.15) {
    Ycalc = 0.8 * Math.pow(Ksod, -0.378);
  } else {
    Ycalc = 0.525;
  }
  return Ycalc;
}

/** 은폐효과 계수 xi 계산 (Function Hiding) */
export function Hiding(Diox: number): number | null {
  if (Diox >= 1.30) {
    return 1.00;
  } else if (Diox > 0.73) {
    return 1.20 * Math.pow(Diox, -0.692);
  } else if (Diox > 0.10) {
    return 0.70 * Math.pow(Diox, -2.385);
  } else {
    return null;
  }
}

/** Psi-Phi 관계 (Gaussian 구적법 10차) (Function PhiPsi) */
export function PhiPsi(Psi: number): number {
  const X = [-0.9739065, -0.8650634, -0.6794096, -0.4333954, -0.1488743,
             0.1488743,  0.4333954,  0.6794096,  0.8650634,  0.9739065];
  const W = [0.0666713, 0.1494513, 0.2190864, 0.2692602, 0.2955242,
             0.2955242, 0.2692602, 0.2190864, 0.1494513, 0.0666713];
  const Astar = 43.47826;
  const Bstar = 0.142857;
  const Eta   = 0.5;
  const PI    = 3.141592654;

  const A  = -Bstar * Psi - 1.0 / Eta;
  const B  =  Bstar * Psi - 1.0 / Eta;
  const C1 = (B - A) / 2.0;
  const C2 = (B + A) / 2.0;
  let VI = 0.0;
  for (let i = 0; i < 10; i++) {
    const XT = C1 * X[i] + C2;
    const T2 = -XT * XT;
    VI += W[i] * Math.exp(T2);
  }
  VI = VI * C1;
  const P  = 1.0 - VI / Math.sqrt(PI);
  return P / (Astar * (1.0 - P));
}

/** Einstein 적분 수치 계산 (Nakato, 1984) */
export function Nakato(Etal: number, Z: number): [number, number] {
  if (Z > 15.0) {
    return [0.0, 0.0];
  }

  const C1 = Math.pow(1.0 - Etal, Z) / Math.pow(Etal, Z);
  const C2 = C1 * Math.log(Etal);

  let I1: number;
  let Eps1 = 0.01;
  if (C1 >= 100.0) {
    while (true) {
      const D1 = Math.pow((1.0 - Eps1) / Eps1, Z);
      if (D1 < 100.0) break;
      Eps1 += 0.01;
    }
    I1 = _Int1(Etal, Z, Eps1, _Simp(Eps1, Z, 1));
  } else {
    I1 = 0.216 * Math.pow(Etal, Z - 1.0) / Math.pow(1.0 - Etal, Z) * _Simp(Etal, Z, 1);
  }

  let I2: number;
  let Eps2 = 0.01;
  if (Math.abs(C2) >= 100.0) {
    while (true) {
      const D2 = Math.pow((1.0 - Eps2) / Eps2, Z) * Math.log(Eps2);
      if (Math.abs(D2) < 100.0) break;
      Eps2 += 0.01;
    }
    I2 = _Int2(Etal, Z, Eps2, _Simp(Eps2, Z, 2));
  } else {
    I2 = 0.216 * Math.pow(Etal, Z - 1.0) / Math.pow(1.0 - Etal, Z) * _Simp(Etal, Z, 2);
  }

  return [I1, I2];
}

function _Simp(Eps: number, Z: number, IC: number): number {
  const f1 = (x: number) => Math.pow((1.0 - x) / x, Z);
  const f2 = (x: number) => f1(x) * Math.log(x);

  const K = 7;
  const IK = Math.pow(2, K);
  const H = (1.0 - Eps) / Math.pow(2, K + 1);
  let Sum1 = 0.0;
  let Sum2 = 0.0;

  for (let i = 1; i <= IK; i++) {
    const x1 = Eps + (2 * i - 1) * H;
    if (IC === 1) Sum1 += f1(x1);
    else Sum1 += f2(x1);

    const x2 = Eps + 2 * i * H - 0.000001;
    if (IC === 1) Sum2 += f1(x2);
    else Sum2 += f2(x2);
  }

  if (IC === 1) {
    Sum2 -= f1(Eps + 2 * IK * H - 0.000001);
    return (H / 3.0) * (f1(Eps) + f1(1.0) + 4.0 * Sum1 + 2.0 * Sum2);
  } else {
    Sum2 -= f2(Eps + 2 * IK * H - 0.000001);
    return (H / 3.0) * (f2(Eps) + f2(1.0) + 4.0 * Sum1 + 2.0 * Sum2);
  }
}

function _Int1(Etal: number, Z: number, Eps: number, I1: number): number {
  const F1 = (Z === 1.0) ? Math.log(Eps / Etal) : (1.0 / (1.0 - Z)) * (Math.pow(Eps, 1.0 - Z) - Math.pow(Etal, 1.0 - Z));
  const F2 = (Z === 2.0) ? -2.0 * Math.log(Eps / Etal) : (Z / (Z - 2.0)) * (Math.pow(Eps, 2.0 - Z) - Math.pow(Etal, 2.0 - Z));
  const F3 = (Z === 3.0) ? 3.0 * Math.log(Eps / Etal) : (Z * (Z - 1.0) / 2.0 / (3.0 - Z)) * (Math.pow(Eps, 3.0 - Z) - Math.pow(Etal, 3.0 - Z));
  return 0.216 * Math.pow(Etal, Z - 1.0) / Math.pow(1.0 - Etal, Z) * (F1 + F2 + F3 + I1);
}

function _Int2(Etal: number, Z: number, Eps: number, I2: number): number {
  const G1 = (Z === 1.0) ? 0.5 * (Math.pow(Math.log(Eps), 2) - Math.pow(Math.log(Etal), 2)) :
    (Math.pow(Eps, 1.0 - Z) / (1.0 - Z) * (Math.log(Eps) - 1.0 / (1.0 - Z)) - Math.pow(Etal, 1.0 - Z) / (1.0 - Z) * (Math.log(Etal) - 1.0 / (1.0 - Z)));
  const G2 = (Z === 2.0) ? -(Math.pow(Math.log(Eps), 2) + Math.pow(Math.log(Etal), 2)) :
    (Z * Math.pow(Eps, 2.0 - Z) / (2.0 - Z) * (Math.log(Eps) - 1.0 / (2.0 - Z)) - Z * Math.pow(Etal, 2.0 - Z) / (2.0 - Z) * (Math.log(Etal) - 1.0 / (2.0 - Z)));
  const G3 = (Z === 3.0) ? 1.5 * (Math.pow(Math.log(Eps), 2) - Math.pow(Math.log(Etal), 2)) :
    (Z * (Z - 1.0) / 2.0 / (3.0 - Z) * Math.pow(Eps, 3.0 - Z) * (Math.log(Eps) - 1.0 / (3.0 - Z)) - Z * (Z - 1.0) / 2.0 / (3.0 - Z) * Math.pow(Etal, 3.0 - Z) * (Math.log(Etal) - 1.0 / (3.0 - Z)));
  return 0.216 * Math.pow(Etal, Z - 1.0) / Math.pow(1.0 - Etal, Z) * (G1 + G2 + G3 + I2);
}

/** 입자조도에 의한 수리반경 Rp 계산 (Subroutine GrainRough) */
export function GrainRough(D65: number, G: number, Nu: number, R: number, S: number, Svp_in: number, V: number): [number, number] {
  let Rp1 = 0.1 * R;
  let Rp = 0;
  let Svp = 0;
  for (let i = 0; i < 200; i++) {
    const Svp1 = Math.sqrt(G * Rp1 * S);
    const Deltap = 11.6 * Nu / Svp1;
    const Ksod = D65 / Deltap;
    const X = SX(Ksod);
    Svp = V / (5.75 * Math.log10(12.27 * Rp1 * X / D65));
    Rp = Math.pow(Svp, 2) / (G * S);
    if (Rp >= R) Rp = R;
    if (Math.abs(Rp - Rp1) / Rp <= 0.01) break;
    Rp1 = Rp;
  }
  return [Rp, Svp];
}

/** 측벽보정 (Subroutine SideWallCorr) */
export function SideWallCorr(B: number, D: number, Q: number, S: number, Sg: number, T: number, G: number, Nu: number, R: number, SM1: number, Sv: number, V: number): [number, number] {
  const f = 8.0 * Math.pow(Sv / V, 2);
  const Re = 4.0 * V * R / Nu;
  const Reof = Re / f;
  if (Reof < 1.0e5 || Reof > 1.0e8) {
    return [R, Sv];
  }
  const fw = 0.0026 * Math.pow(Math.log10(Reof), 2) - 0.0428 * Math.log10(Reof) + 0.1884;
  const fb = f + 2.0 * D / B * (f - fw);
  const Rb = R * fb / f;
  const Sv_new = Math.sqrt(G * Rb * S);
  return [Rb, Sv_new];
}

/** Lagrange 보간법 (Subroutine Lagrange) */
export function Lagrange(N: number, XI: number, XX: number[], YY: number[]): number {
  let P = 0.0;
  for (let i = 0; i < N; i++) {
    let T = 1.0;
    for (let j = 0; j < N; j++) {
      if (i !== j) {
        T = T * (XI - XX[j]) / (XX[i] - XX[j]);
      }
    }
    P += YY[i] * T;
  }
  return P;
}

/** 침강속도 계산 (Function FallVel) - cm/sec */
export function FallVel(Dmm: number, Tdc: number): number {
  const Ds_tbl = [0.04, 0.06, 0.10, 0.20, 0.40, 0.80, 1.50, 2.00, 3.00, 7.00, 10.00];
  const V_tbl = [
    [0.10, 0.24, 0.60, 1.8, 4.6, 9.5, 16.1, 19.9, 25.3, 39.5, 44.0],
    [0.14, 0.32, 0.76, 2.2, 5.3, 10.5, 16.9, 20.3, 25.6, 39.5, 44.0],
    [0.18, 0.40, 0.92, 2.5, 5.8, 11.0, 17.5, 20.7, 25.9, 39.5, 44.0],
    [0.23, 0.49, 1.10, 2.85, 6.3, 11.6, 17.9, 21.1, 26.2, 39.5, 44.0],
    [0.29, 0.57, 1.26, 3.2, 6.7, 12.0, 18.1, 21.5, 26.5, 39.5, 44.0],
  ];

  if (Dmm > 10.0) {
    const Nu_cm = visco(Tdc) * 1.0e4;
    const D_cm = Dmm / 10.0;
    const SM1 = 1.65;
    const g_cm = 980.0;
    return (Math.sqrt(2.0 / 3.0 * g_cm * SM1 * Math.pow(D_cm, 3) + 36.0 * Math.pow(Nu_cm, 2)) - 6.0 * Nu_cm) / D_cm;
  }

  const Tdm = Math.log10(Dmm);
  const Tds = Ds_tbl.map(d => Math.log10(d));
  const It = Math.max(1, Math.min(Math.floor(Tdc / 10) + 1, 4));

  const Tv1 = V_tbl[It - 1].map(v => Math.log10(v));
  const Tv2 = V_tbl[It].map(v => Math.log10(v));

  const V1 = Math.pow(10, Lagrange(11, Tdm, Tds, Tv1));
  const V2 = Math.pow(10, Lagrange(11, Tdm, Tds, Tv2));
  return V1 + (V2 - V1) * (Tdc - 10.0 * (It - 1)) / 10.0;
}

/** 한계소류력(Shields) 계산 (Function Shield) */
export function Shield(D50: number, G: number, Nu: number, SM1: number): number {
  const Dstar = D50 * Math.pow(SM1 * G / Math.pow(Nu, 2), 1.0 / 3.0);
  let Tcr: number;
  if (Dstar <= 4.0) Tcr = 0.24 * Math.pow(Dstar, -1.0);
  else if (Dstar <= 10.0) Tcr = 0.14 * Math.pow(Dstar, -0.64);
  else if (Dstar <= 20.0) Tcr = 0.04 * Math.pow(Dstar, -0.1);
  else if (Dstar <= 150.0) Tcr = 0.013 * Math.pow(Dstar, 0.29);
  else Tcr = 0.055;
  return Math.sqrt(Tcr * SM1 * G * D50);
}

// ============================================================
// E.1 Einstein (1950)
// ============================================================
export function Einstein(inp: InputData) {
  const G = inp.IUnit === 0 ? 9.8 : 32.2;
  const Tdc = inp.IUnit === 0 ? inp.T : (inp.T - 32.0) * 5.0 / 9.0;
  const Nu = visco(Tdc) / (inp.IUnit === 0 ? 1 : Math.pow(0.3048, 2));
  const D35 = inp.D35 / (inp.IUnit === 0 ? 1000 : 304.8);
  const D50 = inp.D50 / (inp.IUnit === 0 ? 1000 : 304.8);
  const D65 = inp.D65 / (inp.IUnit === 0 ? 1000 : 304.8);
  const SM1 = inp.Sg - 1.0;
  const V = inp.Q / (inp.B * inp.D);
  const R = inp.B * inp.D / (inp.B + 2.0 * inp.D);
  let Sv = Math.sqrt(G * R * inp.S);

  let Rb = R;
  if (inp.ISide === 1) {
    [Rb, Sv] = SideWallCorr(inp.B, inp.D, inp.Q, inp.S, inp.Sg, inp.T, G, Nu, R, SM1, Sv, V);
  }

  const [Rp, Svp] = GrainRough(D65, G, Nu, Rb, inp.S, Sv, V);
  const Rtp = Rb - Rp;
  if (Rtp < 0) return { error: "형태조도 수리반경 오류" };

  const Svtp = Rtp > 1e-12 ? Math.sqrt(G * Rtp * inp.S) : 1e-10;
  const Delt = Svp > 0 ? 11.6 * Nu / Svp : 1e10;
  const Ksod = D65 / Delt;
  const Del = D65 / SX(Ksod);
  const X = (Del / Delt >= 1.8) ? 0.77 * Del : 1.398 * Delt;

  const P = 2.303 * Math.log10(30.2 * Rb / Del);
  const Betax = Math.pow(1.025 / Math.log10(10.6 * X / Del), 2);
  const Y = FLift(Ksod);

  const Ds = [0.0625, 0.125, 0.250, 0.500, 1.000, 2.000, 4.000, 8.000, 16.000];
  const Dm = Ds.slice(0, 8).map((d, i) => Math.sqrt(d * Ds[i + 1]) / (inp.IUnit === 0 ? 1000 : 304.8));

  const Nm = inp.ISize === 0 ? 1 : 8;
  const Dm_use = inp.ISize === 0 ? [D50] : Dm;
  const Im_use = inp.ISize === 0 ? [1.0] : inp.Im;

  let Qt = 0;
  const XK = 0.4;

  for (let i = 0; i < Nm; i++) {
    const Di = Dm_use[i];
    const Ib = Im_use[i];
    if (Ib <= 0) continue;

    const Psip = (Rp * inp.S) > 0 ? SM1 * Di / (Rp * inp.S) : 1e10;
    const Diox = Di / X;
    const XI = Hiding(Diox);
    if (XI === null) continue;

    const Psi = Y * Betax * XI * Psip;
    const Phi = Psi <= 30.0 ? PhiPsi(Psi) : 0;

    let Qb = 0;
    if (inp.IUnit === 0) {
      Qb = Phi * Ib * inp.Sg * Math.sqrt(G * SM1) * Math.pow(Di, 1.5);
    } else {
      Qb = Phi * Ib * inp.Sg * 62.4 * 0.000454 * Math.sqrt(G * SM1) * Math.pow(Di, 1.5);
    }

    const Etal = Rb > 0 ? 2.0 * Di / Rb : 0.001;
    const Dmm = Di * (inp.IUnit === 0 ? 1000 : 304.8);
    const Wi = FallVel(Dmm, Tdc) / (inp.IUnit === 0 ? 100 : 30.48);
    const Zi = Svp > 0 ? Wi / (XK * Svp) : 0;

    const [I1, I2] = Nakato(Etal, Zi);
    const Ratio = Math.max(1.0, P * I1 + I2 + 1.0);
    Qt += Qb * Ratio;
  }

  const Qts = Qt * inp.B;
  const Qtd = Qt * 86400 * inp.B;
  const Cv = Qts / (Qts + (inp.IUnit === 0 ? inp.Q : inp.Q * Math.pow(0.3048, 3)));
  const Ct = Cv * inp.Sg / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1e6;

  return { qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct };
}

// ============================================================
// E.2 Colby (1964)
// ============================================================
export function Colby(inp: InputData) {
  // 계수 테이블 (Python 원본과 동일)
  const Ca = [1.453, 1.329, 1.4, 1.26, 1.099, 0.0, 0.0];
  const Cb = [0.61,  0.48,  0.3, 0.3,  0.3,   0.0, 0.0];
  const Cd = [0.1,   0.2,   0.3, 0.4,  0.8,   0.0, 0.0];

  const IUnit = inp.IUnit;

  // D50 유효범위 체크: 0.1mm ~ 0.8mm
  if (inp.D50 < 0.1 || inp.D50 > 0.8) {
    return {
      qt_sec_per_width: -9999, Qt_total_sec: -9999,
      Qt_total_day: -9999, Cv: -9999, Ct_ppm: -9999,
      error_info: `D50=${inp.D50}mm 유효범위(0.1~0.8mm) 이탈`,
    };
  }

  let V_fps: number, D50_ft: number, D_ft: number, Tdc: number;

  if (IUnit === 0) {
    const V = inp.Q / (inp.B * inp.D);
    V_fps  = V / 0.3048;
    D50_ft = inp.D50 / 304.8;
    D_ft   = inp.D / 0.3048;
    Tdc    = inp.T;
  } else {
    V_fps  = inp.Q / (inp.B * inp.D);
    D50_ft = inp.D50 / 304.8;
    D_ft   = inp.D;
    Tdc    = (inp.T - 32.0) * 5.0 / 9.0;
  }

  const Vc  = 0.4673 * Math.pow(D_ft, 0.1) * Math.pow(D50_ft * 304.8, 0.333);
  const Dv  = V_fps - Vc;
  let Bc    = 2.5;
  if (Dv >= 1.0) Bc = 1.453 * Math.pow(D50_ft * 304.8, -0.138);

  // D50 범위 보간
  let N2 = 0;
  while (N2 < 5 && D50_ft > Cd[N2]) N2++;
  N2 = Math.min(Math.max(N2, 1), 5);

  const Ac  = Ca[N2 - 1] * Math.pow(D_ft, Cb[N2 - 1]);
  const Uqs = Math.max(Ac * Math.pow(Math.max(Dv, 0.01), Bc) * 0.672, 1e-10);
  const Qt  = 0.500e-3 * Uqs; // tons/sec/ft

  let Qts: number, Qtd: number, Cv: number, Ct: number;
  if (IUnit === 0) {
    const Qt_si = Qt / 0.3048;
    Qts = Qt_si * inp.B;
    Qtd = Qt_si * 86400 * inp.B;
    Cv  = Qts * (39.2 / 43.2) / inp.Q;
    Ct  = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1.0e6;
  } else {
    Qts = Qt * inp.B;
    Qtd = Qt * 86400 * inp.B;
    Cv  = Qts * (39.2 / 43.2) / (inp.Q * Math.pow(0.3048, 3));
    Ct  = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1.0e6;
  }

  return { qt_sec_per_width: IUnit === 0 ? Qt / 0.3048 : Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct };
}

// ============================================================
// E.3 Engelund & Hansen (1967)
// ============================================================
export function Engelund_Hansen(inp: InputData) {
  const G = inp.IUnit === 0 ? 9.8 : 32.2;
  const Gs = inp.IUnit === 0 ? inp.Sg : inp.Sg * 62.4 * 0.000454;
  const D50 = inp.D50 / (inp.IUnit === 0 ? 1000 : 304.8);
  const V = inp.Q / (inp.B * inp.D);
  const SM1 = inp.Sg - 1.0;

  const Fp = 2.0 * G * inp.S * inp.D / Math.pow(V, 2);
  const Theta = inp.D * inp.S / (SM1 * D50);
  const Phi = 0.1 * Math.pow(Theta, 2.5) / Fp;

  const Qt = Gs * Phi * Math.sqrt(SM1 * G * Math.pow(D50, 3));
  const Qts = Qt * inp.B;
  const Qtd = Qt * 86400 * inp.B;
  const Cv = Qts / (inp.IUnit === 0 ? inp.Q : inp.Q * Math.pow(0.3048, 3));
  const Ct = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1e6;

  return { qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct };
}

// ============================================================
// 공통 전처리 (Pre1 / Pre4)
// ============================================================
export function Pre1(inp: InputData) {
  const Ds = [0.0625, 0.125, 0.250, 0.500, 1.000, 2.000, 4.000, 8.000, 16.000];
  const Dm = Ds.slice(0, 8).map((d, i) => Math.sqrt(d * Ds[i + 1]));

  const IUnit = inp.IUnit;
  let G: number, Tdc: number, D35: number, D50: number, D65: number, D90: number, Dm_m: number[], B: number, D: number, Q: number;

  if (IUnit === 0) {
    G = 9.8; Tdc = inp.T;
    D35 = inp.D35 / 1000.0; D50 = inp.D50 / 1000.0;
    D65 = inp.D65 / 1000.0; D90 = inp.D90 / 1000.0;
    Dm_m = Dm.map(d => d / 1000.0);
    B = inp.B; D = inp.D; Q = inp.Q;
  } else {
    G = 32.2; Tdc = (inp.T - 32.0) * 5.0 / 9.0;
    D35 = inp.D35 / 304.8; D50 = inp.D50 / 304.8;
    D65 = inp.D65 / 304.8; D90 = inp.D90 / 304.8;
    Dm_m = Dm.map(d => d / 304.8);
    B = inp.B; D = inp.D; Q = inp.Q;
  }

  const Nu = visco(Tdc);
  const V = Q / (B * D);
  const R = B * D / (B + 2.0 * D);
  const Sv = Math.sqrt(G * R * inp.S);
  const SM1 = inp.Sg - 1.0;

  return { G, Tdc, Nu, D35, D50, D65, D90, Dm: Dm_m, V, R, Sv, SM1, B, D, Q };
}

export function Pre4(inp: InputData) {
  const Ds = [0.0625, 0.125, 0.250, 0.500, 1.000, 2.000, 4.000, 8.000, 16.000];
  const Dm = Ds.slice(0, 8).map((d, i) => Math.sqrt(d * Ds[i + 1]));

  const IUnit = inp.IUnit;
  let G: number, Tdc: number, Tdf: number, D65: number, Dm_ft: number[], B: number, D: number, Q: number;

  if (IUnit === 0) {
    G = 32.2; Tdc = inp.T; Tdf = inp.T * 9.0 / 5.0 + 32.0;
    D65 = inp.D65 / 304.8;
    Dm_ft = Dm.map(d => d / 304.8);
    B = inp.B / 0.3048; D = inp.D / 0.3048; Q = inp.Q / Math.pow(0.3048, 3);
  } else {
    G = 32.2; Tdc = (inp.T - 32.0) * 5.0 / 9.0; Tdf = inp.T;
    D65 = inp.D65 / 304.8;
    Dm_ft = Dm.map(d => d / 304.8);
    B = inp.B; D = inp.D; Q = inp.Q;
  }

  const Nu = visco(Tdc) / Math.pow(0.3048, 2);
  const V = Q / (B * D);
  const R = B * D / (B + 2.0 * D);
  const Sv = Math.sqrt(G * R * inp.S);
  const SM1 = inp.Sg - 1.0;

  return { G, Tdc, Tdf, Nu, D65, Dm: Dm_ft, V, R, Sv, SM1, B, D, Q };
}

// ============================================================
// E.4 Toffaleti (1968)
// ============================================================
export function Toffaleti(inp: InputData) {
  const p = Pre4(inp);
  const { G, Nu, D65, Dm, V, R, Sv, SM1, B, D, Q: Q_, Tdc, Tdf } = p;
  const S = inp.S; const Sg = inp.Sg; const IUnit = inp.IUnit;

  const [Rp, Svp] = GrainRough(D65, G, Nu, R, S, Sv, V);
  const Am = 10.0 * Svp;
  const P_nu = Nu * 1.0e5;
  const Pam = Math.pow(P_nu, 1.0 / 3.0) / Am;

  let Ap: number;
  if (Pam <= 0.50)       Ap = 10.0 * Math.pow(Pam, -1.487);
  else if (Pam <= 0.67)  Ap = 43.0 * Math.pow(Pam, 0.6142);
  else if (Pam <= 0.725) Ap = 185.0 * Math.pow(Pam, 4.20);
  else if (Pam <= 1.25)  Ap = 49.0;
  else                   Ap = 24.0 * Math.pow(Pam, 2.79);

  const Fac = Pam * S * D65 * 1.0e5;
  let K4: number;
  if (Fac <= 0.25)      K4 = 1.0;
  else if (Fac <= 0.35) K4 = 5.37 * Math.pow(Fac, 1.248);
  else                  K4 = 0.50 * Math.pow(Fac, -1.1);
  if (Ap * K4 < 16.0) Ap = 16.0 / K4;

  const Zv  = 0.1198 + 0.00048 * Tdf;
  const Cv_ = 1.0 + Zv;
  const Ya  = R / 11.24;
  const Yb  = R / 2.5;
  const Cz  = 260.67 - 0.667 * Tdf;
  const Si  = S * R * Cz;
  const Tp  = G * (0.00158 + 0.0000028 * Tdf);
  const T2P = 1.10 * Tp;

  const Nm = inp.ISize === 0 ? 1 : 8;
  const Dm_use = inp.ISize === 0 ? [inp.D65 / 304.8] : Dm;
  const Im_use = inp.ISize === 0 ? [1.0] : inp.Im;

  let Qtd_total = 0.0;

  for (let i = 0; i < Nm; i++) {
    const Di = Dm_use[i]; const Ib = Im_use[i];
    if (Ib <= 0.0) continue;

    const Dmm  = Di * 304.8;
    const Ws_i = FallVel(Dmm, Tdc) / 30.48;
    const Dd   = 2.0 * Di;
    let Zom = Ws_i * V / (Si > 0 ? Si : 1e-10);
    if (Zom < 1.5 * Zv) Zom = 1.5 * Zv;
    const Zo1 = 0.756 * Zom;
    const Zou = 1.5 * Zom;

    const F1 = Zo1 - Zv; const F2 = Zom - Zv; const F3 = Zou - Zv;
    const F4 = 1.0 - F1;  const F5 = 1.0 - F2;  const F6 = 1.0 - F3;

    const Gfp = 0.600 / Math.pow(T2P * Ap / Math.pow(V, 2), 5.0 / 3.0) / Math.pow(Di / 0.00058, 5.0 / 3.0);

    const X_i = Math.abs(Math.pow(Ya, F4) - Math.pow(Dd, F4)) > 1e-15 ? F4 * Gfp / (Math.pow(Ya, F4) - Math.pow(Dd, F4)) : 0.0;
    const C_i = Ib * B * X_i;
    let Qb_i  = C_i * Math.pow(Dd, F4);
    const Ud_i  = Cv_ * V * Math.pow(Dd / R, Zv);
    const Ub1_i = (43.2 * Ud_i * Math.pow(Dd, F1)) > 0 ? X_i / (43.2 * Ud_i * Math.pow(Dd, F1)) : 0.0;
    if (Ub1_i > 100.0) Qb_i = Qb_i * 100.0 / Ub1_i;

    const Ga = C_i / F4 * (Math.pow(Ya, F4) - Math.pow(Dd, F4)) + Qb_i;
    const Gb = C_i / F5 * Math.pow(Ya, F2 - F1) * (Math.pow(Yb, F5) - Math.pow(Ya, F5));
    const Gc = C_i / F6 * Math.pow(Ya, F2 - F1) * Math.pow(Yb, F3 - F2) * (Math.pow(R, F6) - Math.pow(Yb, F6));
    Qtd_total += Ga + Gb + Gc;
  }

  const Qts = Qtd_total / 86400;
  let Cv: number, Ct: number;
  if (IUnit === 0) {
    Cv = Qts / (inp.Q / 0.3048 + Qts * B);
    Ct = Sg * Cv / (Sg + (Sg - 1.0) * Cv) * 1.0e6;
  } else {
    Cv = Qts / (Q_ + Qts * B);
    Ct = Sg * Cv / (Sg + (Sg - 1.0) * Cv) * 1.0e6;
  }

  return { Qt_total_day: Qtd_total, Qt_total_sec: Qts, Ct_ppm: Ct, Cv };
}

// ============================================================
// E.5 Shen & Hung (1971)
// ============================================================
export function Shen_Hung(inp: InputData) {
  const A0 = -107404.45938164; const A1 = 324214.74734085;
  const A2 = -326309.58908739; const A3 = 109503.87232539;
  const A4 = 0.00750189; const A5 = 0.00428802; const A6 = -0.00239974;

  const IUnit = inp.IUnit;
  let V_fps: number, Tdc: number;
  if (IUnit === 0) {
    V_fps = (inp.Q / (inp.B * inp.D)) / 0.3048;
    Tdc   = inp.T;
  } else {
    V_fps = inp.Q / (inp.B * inp.D);
    Tdc   = (inp.T - 32.0) * 5.0 / 9.0;
  }

  const Ws = FallVel(inp.D50, Tdc) / 30.48;
  const X  = Math.pow(V_fps, A4) * Math.pow(inp.S, A5) * Math.pow(Ws, A6);
  const Ct = Math.pow(10.0, A0 + X * (A1 + X * (A2 + A3 * X)));
  const Cv = inp.Sg * Ct * 1.0e-6 / (inp.Sg - (inp.Sg - 1.0) * Ct * 1.0e-6);

  let Qts: number, Qt: number;
  if (IUnit === 0) { Qts = Cv * inp.Q; Qt = Qts / inp.B; }
  else             { Qts = Cv * inp.Q * Math.pow(0.3048, 3); Qt = Qts / (inp.B * 0.3048); }

  const Qtd = Qt * 86400 * (IUnit === 0 ? inp.B : inp.B * 0.3048);

  return { qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct };
}

// ============================================================
// E.6 Ackers & White (1973)
// ============================================================
export function Ackers_White(inp: InputData) {
  const IUnit = inp.IUnit;
  const G   = IUnit === 0 ? 9.8 : 32.2;
  const Tdc = IUnit === 0 ? inp.T : (inp.T - 32.0) * 5.0 / 9.0;
  const Nu  = visco(Tdc) / (IUnit === 0 ? 1 : Math.pow(0.3048, 2));
  const D35 = inp.D35 / (IUnit === 0 ? 1000 : 304.8);
  const V   = inp.Q / (inp.B * inp.D);
  const D = inp.D; const B = inp.B; const Q = inp.Q;
  const SM1 = inp.Sg - 1.0;
  const Sv = Math.sqrt(G * D * inp.S);

  const Dgr = D35 * Math.pow(G * SM1 / Math.pow(Nu, 2), 1.0 / 3.0);
  let Cc: number, Cn: number, Ca: number, Cm: number;
  if (Dgr <= 60.0) {
    const Cldgr = Math.log10(Dgr);
    Cc = Math.pow(10.0, 2.86 * Cldgr - Math.pow(Cldgr, 2) - 3.53);
    Cn = 1.0 - 0.56 * Cldgr;
    Ca = 0.23 / Math.sqrt(Dgr) + 0.14;
    Cm = 9.66 / Dgr + 1.34;
  } else { Cc = 0.025; Cn = 0.0; Ca = 0.17; Cm = 1.50; }

  const Fgr = Math.pow(Sv, Cn) / Math.sqrt(G * D35 * SM1) *
              Math.pow(V / (Math.sqrt(32.0) * Math.log10(10.0 * D / D35)), 1.0 - Cn);

  if (Fgr <= Ca) {
    return { qt_sec_per_width: 0.0, Qt_total_sec: 0.0, Qt_total_day: 0.0, Cv: 0.0, Ct_ppm: 0.0,
             error_info: `Fgr(${Fgr.toFixed(4)}) <= Ca(${Ca.toFixed(4)}): 이송 없음` };
  }

  const Ggr = Cc * Math.pow(Fgr / Ca - 1.0, Cm);
  const Cx  = Ggr * inp.Sg * D35 / D * Math.pow(V / Sv, Cn);
  const Ct  = Cx * 1.0e6;
  const Cv  = inp.Sg * Cx / (inp.Sg - (inp.Sg - 1.0) * Cx);

  let Qts: number, Qt: number;
  if (IUnit === 0) { Qts = Cv * Q; Qt = Qts / B; }
  else             { Qts = Cv * Q * Math.pow(0.3048, 3); Qt = Qts / (B * 0.3048); }
  const Qtd = Qt * 86400 * (IUnit === 0 ? B : B * 0.3048);

  return { qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct };
}

// ============================================================
// E.7 Yang (1973, 1979)
// ============================================================
export function Yang(inp: InputData) {
  const IUnit = inp.IUnit;
  const G   = IUnit === 0 ? 9.8 : 32.2;
  const Tdc = IUnit === 0 ? inp.T : (inp.T - 32.0) * 5.0 / 9.0;
  const Nu  = visco(Tdc) / (IUnit === 0 ? 1 : Math.pow(0.3048, 2));
  const D50 = inp.D50 / (IUnit === 0 ? 1000 : 304.8);
  const B = inp.B; const D = inp.D; const Q = inp.Q;
  const V = Q / (B * D);
  const R_y = B * D / (B + 2.0 * D);
  const Sv  = Math.sqrt(G * R_y * inp.S);

  const Ds_std = [0.0625, 0.125, 0.250, 0.500, 1.000, 2.000, 4.000, 8.000, 16.000];
  const Dm_list = Ds_std.slice(0, 8).map((d, i) => Math.sqrt(d * Ds_std[i + 1]));
  const Dm_use = IUnit === 0 ? Dm_list.map(d => d / 1000.0) : Dm_list.map(d => d / 304.8);

  const Nm = inp.ISize === 0 ? 1 : 8;
  const Dm_calc = inp.ISize === 0 ? [D50] : Dm_use;
  const Im_use  = inp.ISize === 0 ? [1.0] : inp.Im;

  let Ct73 = 0.0; let Ct79 = 0.0;

  for (let i = 0; i < Nm; i++) {
    const Di = Dm_calc[i]; const Ib = Im_use[i];
    if (Ib <= 0.0) continue;

    const Dmm = IUnit === 0 ? Di * 1000.0 : Di * 304.8;
    const W   = IUnit === 0 ? FallVel(Dmm, Tdc) / 100.0 : FallVel(Dmm, Tdc) / 30.48;
    const Rey = Sv * Di / Nu;
    let Vcw = 2.05;
    if (Rey > 1.2 && Rey < 70.0) Vcw = 2.5 / (Math.log10(Rey) - 0.06) + 0.66;

    const Wdnu = W * Di / Nu;
    const Svw  = W > 0 ? Sv / W : 0;

    const arg73 = V * inp.S / W - Vcw * inp.S;
    if (arg73 > 0) {
      const Lct73 = 5.435 - 0.286 * Math.log10(Wdnu) - 0.457 * Math.log10(Svw) +
                    (1.799 - 0.409 * Math.log10(Wdnu) - 0.314 * Math.log10(Svw)) * Math.log10(arg73);
      Ct73 += Math.pow(10.0, Lct73) * Ib;
    }
    const arg79 = V * inp.S / W;
    if (arg79 > 0) {
      const Lct79 = 5.165 - 0.153 * Math.log10(Wdnu) - 0.297 * Math.log10(Svw) +
                    (1.780 - 0.360 * Math.log10(Wdnu) - 0.480 * Math.log10(Svw)) * Math.log10(arg79);
      Ct79 += Math.pow(10.0, Lct79) * Ib;
    }
  }

  const ctToQ = (Ct_ppm: number) => {
    const Cv = inp.Sg * Ct_ppm * 1.0e-6 / (inp.Sg - (inp.Sg - 1.0) * Ct_ppm * 1.0e-6);
    let Qts: number, Qt: number;
    if (IUnit === 0) { Qts = Cv * Q; Qt = Qts / B; }
    else             { Qts = Cv * Q * Math.pow(0.3048, 3); Qt = Qts / (B * 0.3048); }
    const Qtd = Qt * 86400 * (IUnit === 0 ? B : B * 0.3048);
    return { Cv, Qt_total_sec: Qts, qt_sec_per_width: Qt, Qt_total_day: Qtd, Ct_ppm };
  };

  return { formula: "Yang (1973/1979)", IUnit: IUnit === 0 ? "SI" : "영미",
           Yang1973: ctToQ(Ct73), Yang1979: ctToQ(Ct79) };
}

// ============================================================
// E.8 Ranga Raju (1981)
// ============================================================
export function Ranga_Raju(inp: InputData) {
  const IUnit = inp.IUnit;
  let G: number, Nu: number, Gs: number, Gf: number, D50: number;
  let V: number, R: number, SM1: number, Sv: number, B: number, D: number, Q: number;

  if (IUnit === 0) {
    G = 9.8; Nu = visco(inp.T); Gs = inp.Sg; Gf = 1.0;
    D50 = inp.D50 / 1000.0;
  } else {
    G = 32.2; Gs = inp.Sg * 62.4 * 0.000454; Gf = 62.4 * 0.000454;
    Nu = visco((inp.T - 32.0) * 5.0 / 9.0) / Math.pow(0.3048, 2);
    D50 = inp.D50 / 304.8;
  }
  B = inp.B; D = inp.D; Q = inp.Q;
  V = Q / (B * D); R = B * D / (B + 2.0 * D);
  SM1 = inp.Sg - 1.0; Sv = Math.sqrt(G * R * inp.S);

  let Rb = R;
  if (inp.ISide === 1) [Rb, Sv] = SideWallCorr(B, D, Q, inp.S, inp.Sg, inp.T, G, Nu, R, SM1, Sv, V);

  let Rn: number, Rbp: number;
  if (IUnit === 0) {
    Rn = Math.pow(D50, 1.0 / 6.0) / 24.0;
    Rbp = Math.pow(V * Rn / Math.sqrt(inp.S), 1.5);
  } else {
    Rn = 0.034 * Math.pow(D50, 1.0 / 6.0);
    Rbp = Math.pow(V * Rn / (Math.sqrt(inp.S) * 1.489), 1.5);
  }

  const Top = Gf * Rbp * inp.S;
  const To  = Gf * Rb  * inp.S;
  const Tsp = D50 > 0 ? Top / ((inp.Sg - 1.0) * D50) : 0.0;
  const Ws  = (Math.sqrt(2.0 / 3.0 * G * SM1 * Math.pow(D50, 3) + 36.0 * Math.pow(Nu, 2)) - 6.0 * Nu) / D50;
  const Svw = Ws > 0 ? Sv / Ws : 0;

  let Rm = 0.0;
  if (Svw >= 0.5) Rm = 0.2 * Svw - 0.10;
  const Phit = 60.0 * Math.pow(Tsp, 3) * Math.pow(Top / To, -3.0 * Rm);

  const Qt  = Phit * Gs * Math.sqrt(SM1 * G * Math.pow(D50, 3));
  const Qts = Qt * B; const Qtd = Qt * 86400 * B;
  const Cv  = IUnit === 0 ? Qts / Q : Qts / (Q * Math.pow(0.3048, 3));
  const Ct  = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1.0e6;

  return { qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct };
}

// ============================================================
// E.9 Rijn (1984)
// ============================================================
export function Rijn(inp: InputData) {
  const Co = 0.65; const Kappa = 0.4;
  const IUnit = inp.IUnit;
  let G: number, Gs: number, Nu: number;
  let D50: number, D65: number, D90: number;
  let V: number, R: number, SM1: number, B: number, D: number, Q: number;

  if (IUnit === 0) {
    G = 9.8; Gs = inp.Sg; Nu = visco(inp.T);
    D50 = inp.D50/1000.0; D65 = inp.D65/1000.0; D90 = inp.D90/1000.0;
  } else {
    G = 32.2; Gs = inp.Sg * 62.4 * 0.000454;
    Nu = visco((inp.T-32.0)*5.0/9.0) / Math.pow(0.3048, 2);
    D50 = inp.D50/304.8; D65 = inp.D65/304.8; D90 = inp.D90/304.8;
  }
  B = inp.B; D = inp.D; Q = inp.Q;
  V = Q/(B*D); R = B*D/(B+2.0*D); SM1 = inp.Sg-1.0;

  // D50 유효범위 체크: 0.1mm ~ 2.0mm
  if (inp.D50 < 0.1 || inp.D50 > 2.0) {
    return {
      Qt_total_sec: -9999, Qt_total_day: -9999,
      Cv: -9999, Ct_ppm: -9999,
      error_info: `D50=${inp.D50}mm 유효범위(0.1~2.0mm) 이탈`,
      qb_bed_load_vol: -9999, qs_susp_load_vol: -9999,
    };
  }

  let Sv_main = Math.sqrt(G * R * inp.S);
  const Dst = D50 * Math.pow(SM1 * G / Math.pow(Nu, 2), 1.0/3.0);
  const Csv = Shield(D50, G, Nu, SM1);

  if (inp.ISide === 1) {
    const [_, sv] = SideWallCorr(B, D, Q, inp.S, inp.Sg, inp.T, G, Nu, R, SM1, Sv_main, V);
    Sv_main = sv;
  }

  let Cp = 18.0 * Math.log10(4.0 * R / D90);
  if (IUnit === 1) Cp = Cp / 0.5521;
  const Svp = Math.sqrt(G) * V / Cp;
  const Td  = Csv > 0 ? (Math.pow(Svp, 2) - Math.pow(Csv, 2)) / Math.pow(Csv, 2) : 0.0;

  if (Td < 0.0) {
    return { Qt_total_sec: 0.0, Qt_total_day: 0.0, Cv: 0.0, Ct_ppm: 0.0,
             error_info: `Td=${Td.toFixed(4)} < 0: 임계전단속도 미달` };
  }

  let Ad = inp.Delta * 0.5;
  if (Ad <= 0.0) Ad = D65;
  if (Ad < 0.01 * D) Ad = 0.01 * D;

  const Ca = (Ad > 0 && Dst > 0) ? 0.015 * D50 * Math.pow(Td, 1.5) / (Ad * Math.pow(Dst, 0.3)) : 0.0;
  const Ds = inp.Grd <= 0.0 ? D50 * 2.5e-3 : D50 * (1.0 + 0.011 * (inp.Grd - 1.0) * (Td - 25.0));
  const Ds_mm = IUnit === 0 ? Ds * 1000.0 : Ds * 304.8;

  let Ws: number;
  if (Ds_mm <= 0.1)      Ws = SM1 * G * Math.pow(Ds, 2) / (18.0 * Nu);
  else if (Ds_mm <= 1.0) Ws = 10.0 * Nu / Ds * (Math.sqrt(1.0 + 0.01 * SM1 * G * Math.pow(Ds, 3) / Math.pow(Nu, 2)) - 1.0);
  else                   Ws = 1.1 * Math.sqrt(SM1 * G * Ds);

  const Beta = 1.0 + 2.0 * Math.pow(Ws / Sv_main, 2);
  const Phi  = 2.5 * Math.pow(Ws / Sv_main, 0.8) * Math.pow(Ca / Co, 0.4);
  const Z    = (Beta * Kappa * Sv_main) > 0 ? Ws / (Beta * Kappa * Sv_main) : 0.0;
  const Zp   = Z + Phi;
  const F_val = Math.abs(1.2 - Zp) > 1e-8 ?
    (Math.pow(Ad/D, Zp) - Math.pow(Ad/D, 1.2)) / (Math.pow(1.0-Ad/D, Zp) * (1.2-Zp)) : 0.0;

  const Qb_vol = 0.053 * Math.pow(Td, 2.1) / Math.pow(Dst, 0.3) * Math.sqrt(SM1 * G * Math.pow(D50, 3));
  const Qs_vol = F_val * V * D * Ca;
  const Qt_vol = Qb_vol + Qs_vol;
  const Qt_w   = Qt_vol * Gs;
  const Qts    = Qt_w * B;
  const Qtd    = Qt_w * 86400 * B;
  const Cv     = IUnit === 0 ? Qts / Q : Qts / (Q * Math.pow(0.3048, 3));
  const Ct     = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1.0e6;

  // 복소수 발생 시 (Ad/D > 1 등 경계조건 이탈) → NaN/Infinity로 튀어나옴 → -9999 처리
  if (!isFinite(Qtd) || isNaN(Qtd)) {
    return {
      Qt_total_sec: -9999, Qt_total_day: -9999,
      Cv: -9999, Ct_ppm: -9999,
      error_info: '복소수 발생 (경계조건 이탈) - 계산 불가',
      qb_bed_load_vol: -9999, qs_susp_load_vol: -9999,
    };
  }

  return { Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct,
           qb_bed_load_vol: Qb_vol, qs_susp_load_vol: Qs_vol };
}

// ============================================================
// 통합 실행 함수
// ============================================================
export function runAll(inp: InputData, formulas?: string[]) {
  const allFormulas: Record<string, (inp: InputData) => any> = {
    'Einstein': Einstein, 'Colby': Colby, 'Engelund_Hansen': Engelund_Hansen,
    'Toffaleti': Toffaleti, 'Shen_Hung': Shen_Hung, 'Ackers_White': Ackers_White,
    'Yang': Yang, 'Ranga_Raju': Ranga_Raju, 'Rijn': Rijn,
  };
  const selected = formulas || Object.keys(allFormulas);
  const results: Record<string, any> = {};
  for (const name of selected) {
    if (allFormulas[name]) {
      try { results[name] = allFormulas[name](inp); }
      catch (e: any) { results[name] = { error: e.message }; }
    }
  }
  return results;
}

// ============================================================
// ★ 수정: 인풋파일 생성 (원본 Fortran Sediment.Dat 형식)
// ============================================================

/**
 * InputData → Sediment.Dat 형식 문자열
 *
 * Line 1: Title
 * Line 2: IUnit ISize ISide
 * Line 3: B  D  Q  S  T  Bedform   ← 모두 한 줄 (기존 코드 버그 수정)
 * Line 4: D35  D50  D65  D90  Sg  Grd  Delta
 * Line 5: Im[0..7]  (ISize=1 일 때만)
 */
export function formatSedimentInput(inp: InputData): string {
  const f = (n: number, d: number) => n.toFixed(d);
  let s = `${inp.Title}\n`;
  s += `${inp.IUnit} ${inp.ISize} ${inp.ISide}\n`;
  // Line 3: B D Q S T Bedform — 전부 한 줄
  s += `${f(inp.B,4)} ${f(inp.D,4)} ${f(inp.Q,4)} ${f(inp.S,7)} ${f(inp.T,1)} ${inp.Bedform}\n`;
  // Line 4: D35 D50 D65 D90 Sg Grd Delta
  s += `${f(inp.D35,4)} ${f(inp.D50,4)} ${f(inp.D65,4)} ${f(inp.D90,4)} ${f(inp.Sg,3)} ${f(inp.Grd,3)} ${f(inp.Delta,4)}\n`;
  // Line 5: Im (ISize=1 일 때만)
  if (inp.ISize === 1) {
    s += inp.Im.map(v => f(v, 4)).join(' ') + '\n';
  }
  return s;
}

/**
 * 전체 결과 요약 출력 문자열 생성
 */
export function formatSedimentOutput(inp: InputData, results: any): string {
  let s = "============================================================\n";
  s += "      SEDIMENT TRANSPORT CALCULATION DETAILED REPORT\n";
  s += "============================================================\n\n";
  s += `[INPUT]\n`;
  s += `Title   : ${inp.Title}\n`;
  s += `Unit    : ${inp.IUnit === 0 ? 'SI (m, cms, °C)' : 'English'} | ISize: ${inp.ISize} | ISide: ${inp.ISide}\n`;
  s += `B=${inp.B.toFixed(3)}m  D=${inp.D.toFixed(3)}m  Q=${inp.Q.toFixed(3)}cms  S=${inp.S.toFixed(6)}\n`;
  s += `T=${inp.T.toFixed(1)}°C  Bedform=${inp.Bedform}\n`;
  s += `D35=${inp.D35.toFixed(3)}mm  D50=${inp.D50.toFixed(3)}mm  D65=${inp.D65.toFixed(3)}mm  D90=${inp.D90.toFixed(3)}mm\n`;
  s += `Sg=${inp.Sg.toFixed(3)}  Grd=${inp.Grd.toFixed(3)}  Delta=${inp.Delta.toFixed(3)}m\n\n`;
  s += "------------------------------------------------------------\n";
  s += `${'공식'.padEnd(20)} ${'Qt(ton/day)'.padStart(15)} ${'Ct(ppm)'.padStart(12)}\n`;
  s += "------------------------------------------------------------\n";

  const addLine = (name: string, res: any) => {
    if (!res || res.error) { s += `${name.padEnd(20)} ERROR\n`; return; }
    const qt = res.Qt_total_day ?? 0;
    const ct = res.Ct_ppm ?? 0;
    s += `${name.padEnd(20)} ${qt.toFixed(4).padStart(15)} ${ct.toFixed(2).padStart(12)}\n`;
    if (res.Yang1979) {
      s += `${'Yang(1979)'.padEnd(20)} ${res.Yang1979.Qt_total_day.toFixed(4).padStart(15)} ${res.Yang1979.Ct_ppm.toFixed(2).padStart(12)}\n`;
    }
  };

  ['Einstein','Colby','Engelund_Hansen','Toffaleti','Shen_Hung',
   'Ackers_White','Yang','Ranga_Raju','Rijn'].forEach(name => {
    const key = name === 'Yang' ? 'Yang' : name;
    const res = results[key];
    const displayName = name === 'Yang' ? 'Yang(1973)' : name;
    if (name === 'Yang' && res) {
      addLine('Yang(1973)', res.Yang1973);
      addLine('Yang(1979)', res.Yang1979);
    } else {
      addLine(displayName, res);
    }
  });

  s += "------------------------------------------------------------\n";
  return s;
}

/**
 * 단일 공식 결과 출력
 */
export function formatSingleFormulaOutput(inp: InputData, formulaName: string, res: any): string {
  let s = "============================================================\n";
  s += `      ${formulaName.toUpperCase()}\n`;
  s += "============================================================\n";
  s += `Title: ${inp.Title}\n`;
  s += `B=${inp.B.toFixed(3)}  D=${inp.D.toFixed(3)}  Q=${inp.Q.toFixed(3)}  S=${inp.S.toFixed(6)}\n`;
  s += `D50=${inp.D50.toFixed(4)}  Sg=${inp.Sg.toFixed(3)}  T=${inp.T.toFixed(1)}\n\n`;

  if (!res || res.error) {
    s += `Status: ERROR\nMessage: ${res?.error || 'N/A'}\n`;
    return s;
  }

  if (formulaName === 'Yang') {
    s += `[Yang 1973] Qt = ${(res.Yang1973?.Qt_total_day||0).toFixed(4)} ton/day  Ct = ${(res.Yang1973?.Ct_ppm||0).toFixed(2)} ppm\n`;
    s += `[Yang 1979] Qt = ${(res.Yang1979?.Qt_total_day||0).toFixed(4)} ton/day  Ct = ${(res.Yang1979?.Ct_ppm||0).toFixed(2)} ppm\n`;
  } else {
    s += `Qt_total_day = ${(res.Qt_total_day||0).toFixed(4)} ton/day\n`;
    s += `Ct_ppm       = ${(res.Ct_ppm||0).toFixed(4)} ppm\n`;
    s += `Cv           = ${(res.Cv||0).toFixed(6)}\n`;
  }
  s += "============================================================\n";
  return s;
}
