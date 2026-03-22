
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
  B: number;        // Width
  D: number;        // Depth
  Q: number;        // Discharge
  S: number;        // Energy Slope
  T: number;        // Temperature
  Bedform: string;
  D35: number;      // mm
  D50: number;      // mm
  D65: number;      // mm
  D90: number;      // mm
  Sg: number;       // Specific Gravity
  Grd: number;      // Gradation Coefficient
  Delta: number;    // Dune height
  Im: number[];     // 8 distribution ratios (0~1)
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
    return null; // 호출자에서 null이면 해당 분수 건너뜀
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

/** Simpson 법칙에 의한 적분 (Function _Simp) */
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

/** 적분식 I1 계산 (Function _Int1) */
function _Int1(Etal: number, Z: number, Eps: number, I1: number): number {
  let F1 = (Z === 1.0) ? Math.log(Eps / Etal) : (1.0 / (1.0 - Z)) * (Math.pow(Eps, 1.0 - Z) - Math.pow(Etal, 1.0 - Z));
  let F2 = (Z === 2.0) ? -2.0 * Math.log(Eps / Etal) : (Z / (Z - 2.0)) * (Math.pow(Eps, 2.0 - Z) - Math.pow(Etal, 2.0 - Z));
  let F3 = (Z === 3.0) ? 3.0 * Math.log(Eps / Etal) : (Z * (Z - 1.0) / 2.0 / (3.0 - Z)) * (Math.pow(Eps, 3.0 - Z) - Math.pow(Etal, 3.0 - Z));
  return 0.216 * Math.pow(Etal, Z - 1.0) / Math.pow(1.0 - Etal, Z) * (F1 + F2 + F3 + I1);
}

/** 적분식 I2 계산 (Function _Int2) */
function _Int2(Etal: number, Z: number, Eps: number, I2: number): number {
  let G1 = (Z === 1.0) ? 0.5 * (Math.pow(Math.log(Eps), 2) - Math.pow(Math.log(Etal), 2)) :
    (Math.pow(Eps, 1.0 - Z) / (1.0 - Z) * (Math.log(Eps) - 1.0 / (1.0 - Z)) - Math.pow(Etal, 1.0 - Z) / (1.0 - Z) * (Math.log(Etal) - 1.0 / (1.0 - Z)));
  let G2 = (Z === 2.0) ? -(Math.pow(Math.log(Eps), 2) + Math.pow(Math.log(Etal), 2)) :
    (Z * Math.pow(Eps, 2.0 - Z) / (2.0 - Z) * (Math.log(Eps) - 1.0 / (2.0 - Z)) - Z * Math.pow(Etal, 2.0 - Z) / (2.0 - Z) * (Math.log(Etal) - 1.0 / (2.0 - Z)));
  let G3 = (Z === 3.0) ? 1.5 * (Math.pow(Math.log(Eps), 2) - Math.pow(Math.log(Etal), 2)) :
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
  const G = inp.IUnit === 0 ? 9.8 : 32.2;
  const Tdc = inp.IUnit === 0 ? inp.T : (inp.T - 32.0) * 5.0 / 9.0;
  const D50 = inp.D50; // mm
  const V = inp.Q / (inp.B * inp.D);
  const Vfps = inp.IUnit === 1 ? V : V / 0.3048;
  const Dft = inp.IUnit === 1 ? inp.D : inp.D / 0.3048;

  const V_tbl = [2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 12.0, 15.0];
  const D_tbl = [0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1.0];
  const Q_tbl = [
    [0.006, 0.02, 0.04, 0.08, 0.14, 0.22, 0.32, 0.45, 0.60, 1.0, 1.8],
    [0.004, 0.015, 0.035, 0.07, 0.12, 0.20, 0.28, 0.40, 0.55, 0.9, 1.6],
    [0.002, 0.01, 0.025, 0.05, 0.10, 0.16, 0.24, 0.35, 0.48, 0.8, 1.4],
    [0.001, 0.006, 0.02, 0.04, 0.08, 0.14, 0.20, 0.30, 0.42, 0.7, 1.3],
    [0.0004, 0.003, 0.01, 0.025, 0.05, 0.09, 0.14, 0.22, 0.32, 0.55, 1.1],
    [0.0002, 0.002, 0.006, 0.015, 0.035, 0.07, 0.11, 0.17, 0.25, 0.45, 0.9],
    [0.0001, 0.001, 0.004, 0.01, 0.025, 0.05, 0.08, 0.13, 0.20, 0.38, 0.8]
  ];

  let qb_base = 0;
  if (D50 >= 0.1 && D50 <= 1.0 && Vfps >= 2.0) {
    const qb_d = Q_tbl.map(row => Math.pow(10, Lagrange(11, Math.log10(Vfps), V_tbl.map(v => Math.log10(v)), row.map(q => Math.log10(q)))));
    qb_base = Math.pow(10, Lagrange(7, Math.log10(D50), D_tbl.map(d => Math.log10(d)), qb_d.map(q => Math.log10(q))));
  }

  const D_corr_tbl = [0.1, 1.0, 10.0, 100.0];
  const C_corr_tbl = [
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    [0.4, 0.6, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6, 1.9],
    [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0, 1.15, 1.3, 1.6, 2.1],
    [0.02, 0.08, 0.15, 0.25, 0.35, 0.45, 0.6, 0.75, 0.9, 1.2, 1.8]
  ];

  let k_depth = 1.0;
  if (Vfps >= 2.0) {
    const k_v = C_corr_tbl.map(row => Lagrange(11, Vfps, V_tbl, row));
    k_depth = Lagrange(4, Math.log10(Dft), D_corr_tbl.map(d => Math.log10(d)), k_v);
  }

  const T_tbl = [32.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0];
  const K_tbl = [
    [0.5, 0.7, 0.85, 1.0, 1.15, 1.3, 1.45, 1.6],
    [0.8, 0.85, 0.92, 1.0, 1.08, 1.15, 1.22, 1.3],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
  ];

  const T_eng = inp.IUnit === 1 ? inp.T : inp.T * 9.0 / 5.0 + 32.0;
  const k_t_d = K_tbl.map(row => Lagrange(8, T_eng, T_tbl, row));
  const k_temp = Lagrange(3, Math.log10(D50), [Math.log10(0.1), Math.log10(0.3), Math.log10(1.0)], k_t_d);

  const Qt_lb_sec_ft = qb_base * k_depth * k_temp;
  let Qt = 0;
  if (inp.IUnit === 0) {
    Qt = Qt_lb_sec_ft * 0.4536 / 0.3048;
  } else {
    Qt = Qt_lb_sec_ft;
  }

  const Qts = Qt * inp.B;
  const Qtd = Qt * 86400 * inp.B;
  const Cv = Qts / (Qts + (inp.IUnit === 0 ? inp.Q * 1000 : inp.Q * 62.4));
  const Ct = Cv * 1e6;

  return { qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct };
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
    G = 9.8;
    Tdc = inp.T;
    D35 = inp.D35 / 1000.0;
    D50 = inp.D50 / 1000.0;
    D65 = inp.D65 / 1000.0;
    D90 = inp.D90 / 1000.0;
    Dm_m = Dm.map(d => d / 1000.0);
    B = inp.B; D = inp.D; Q = inp.Q;
  } else {
    G = 32.2;
    Tdc = (inp.T - 32.0) * 5.0 / 9.0;
    D35 = inp.D35 / 304.8;
    D50 = inp.D50 / 304.8;
    D65 = inp.D65 / 304.8;
    D90 = inp.D90 / 304.8;
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
  let G: number, Tdc: number, Tdf: number, D35: number, D50: number, D65: number, D90: number, Dm_ft: number[], B: number, D: number, Q: number;

  if (IUnit === 0) {
    G = 32.2;
    Tdc = inp.T;
    Tdf = inp.T * 9.0 / 5.0 + 32.0;
    D35 = inp.D35 / 304.8;
    D50 = inp.D50 / 304.8;
    D65 = inp.D65 / 304.8;
    D90 = inp.D90 / 304.8;
    Dm_ft = Dm.map(d => d / 304.8);
    B = inp.B / 0.3048;
    D = inp.D / 0.3048;
    Q = inp.Q / Math.pow(0.3048, 3);
  } else {
    G = 32.2;
    Tdc = (inp.T - 32.0) * 5.0 / 9.0;
    Tdf = inp.T;
    D35 = inp.D35 / 304.8;
    D50 = inp.D50 / 304.8;
    D65 = inp.D65 / 304.8;
    D90 = inp.D90 / 304.8;
    Dm_ft = Dm.map(d => d / 304.8);
    B = inp.B; D = inp.D; Q = inp.Q;
  }

  const Nu = visco(Tdc) / Math.pow(0.3048, 2);
  const V = Q / (B * D);
  const R = B * D / (B + 2.0 * D);
  const Sv = Math.sqrt(G * R * inp.S);
  const SM1 = inp.Sg - 1.0;

  return { G, Tdc, Tdf, Nu, D35, D50, D65, D90, Dm: Dm_ft, V, R, Sv, SM1, B, D, Q };
}

// ============================================================
// E.4 Toffaleti (1968)
// ============================================================
export function Toffaleti(inp: InputData) {
  const p = Pre4(inp);
  const { G, Nu, D65, Dm, V, R, Sv, SM1, B, D, Q: Q_, Tdc, Tdf } = p;
  const S = inp.S;
  const Sg = inp.Sg;
  const IUnit = inp.IUnit;

  const [Rp, Svp] = GrainRough(D65, G, Nu, R, S, Sv, V);

  const Am = 10.0 * Svp;
  const P_nu = Nu * 1.0e5;
  const Pam = Math.pow(P_nu, 1.0 / 3.0) / Am;

  let Ap: number;
  if (Pam <= 0.50) {
    Ap = 10.0 * Math.pow(Pam, -1.487);
  } else if (Pam <= 0.67) {
    Ap = 43.0 * Math.pow(Pam, 0.6142);
  } else if (Pam <= 0.725) {
    Ap = 185.0 * Math.pow(Pam, 4.20);
  } else if (Pam <= 1.25) {
    Ap = 49.0;
  } else {
    Ap = 24.0 * Math.pow(Pam, 2.79);
  }

  const Fac = Pam * S * D65 * 1.0e5;
  let K4: number;
  if (Fac <= 0.25) {
    K4 = 1.0;
  } else if (Fac <= 0.35) {
    K4 = 5.37 * Math.pow(Fac, 1.248);
  } else {
    K4 = 0.50 * Math.pow(Fac, -1.1);
  }

  if (Ap * K4 < 16.0) {
    Ap = 16.0 / K4;
  }

  const Zv = 0.1198 + 0.00048 * Tdf;
  const Cv_ = 1.0 + Zv;
  const Ya = R / 11.24;
  const Yb = R / 2.5;
  const Cz = 260.67 - 0.667 * Tdf;
  const Si = S * R * Cz;
  const Tp = G * (0.00158 + 0.0000028 * Tdf);
  const T2P = 1.10 * Tp;

  const Nm = inp.ISize === 0 ? 1 : 8;
  const Dm_use = inp.ISize === 0 ? [inp.D65 / 304.8] : Dm;
  const Im_use = inp.ISize === 0 ? [1.0] : inp.Im;

  let Qtd_total = 0.0;
  const rows: any[] = [];

  for (let i = 0; i < Nm; i++) {
    const Di = Dm_use[i];
    const Ib = Im_use[i];
    if (Ib <= 0.0) continue;

    const Dmm = Di * 304.8;
    const Ws_i = FallVel(Dmm, Tdc) / 30.48;
    const Dd = 2.0 * Di;
    let Zom = Ws_i * V / (Si > 0 ? Si : 1e-10);
    if (Zom < 1.5 * Zv) Zom = 1.5 * Zv;
    const Zo1 = 0.756 * Zom;
    const Zou = 1.5 * Zom;

    const F1 = Zo1 - Zv;
    const F2 = Zom - Zv;
    const F3 = Zou - Zv;
    const F4_val = 1.0 - F1;
    const F5_val = 1.0 - F2;
    const F6_val = 1.0 - F3;

    const Gfp = (0.600 / Math.pow(T2P * Ap / Math.pow(V, 2), 5.0 / 3.0) /
                 Math.pow(Di / 0.00058, 5.0 / 3.0));

    const X_i = Math.abs(Math.pow(Ya, F4_val) - Math.pow(Dd, F4_val)) > 1e-15 ? F4_val * Gfp / (Math.pow(Ya, F4_val) - Math.pow(Dd, F4_val)) : 0.0;
    const C_i = Ib * B * X_i;
    let Qb_i = C_i * Math.pow(Dd, F4_val);
    const Ud_i = Cv_ * V * Math.pow(Dd / R, Zv);
    const Ub1_i = (43.2 * Ud_i * Math.pow(Dd, F1)) > 0 ? X_i / (43.2 * Ud_i * Math.pow(Dd, F1)) : 0.0;

    if (Ub1_i > 100.0) {
      Qb_i = Qb_i * 100.0 / Ub1_i;
    }

    const Ga_i = C_i / F4_val * (Math.pow(Ya, F4_val) - Math.pow(Dd, F4_val)) + Qb_i;
    const Gb_i = (C_i / F5_val * Math.pow(Ya, F2 - F1) * (Math.pow(Yb, F5_val) - Math.pow(Ya, F5_val)));
    const Gc_i = (C_i / F6_val * Math.pow(Ya, F2 - F1) * Math.pow(Yb, F3 - F2) * (Math.pow(R, F6_val) - Math.pow(Yb, F6_val)));
    const Gt_i = Ga_i + Gb_i + Gc_i;
    Qtd_total += Gt_i;
    rows.push({ fraction: i + 1, Di_mm: Dmm, Im: Ib, Gt: Gt_i });
  }

  const Qts = Qtd_total / (3600.0 * 24.0);
  const Qtd = Qtd_total;

  let Ct: number;
  let Cv: number;
  if (IUnit === 0) {
    const Qts_si = Qts * B * 0.3048 / B;
    Cv = Qts / (inp.Q / 0.3048 + Qts * B);
    Ct = Sg * Cv / (Sg + (Sg - 1.0) * Cv) * 1.0e6;
  } else {
    Cv = Qts / (Q_ + Qts * B);
    Ct = Sg * Cv / (Sg + (Sg - 1.0) * Cv) * 1.0e6;
  }

  return {
    formula: "Toffaleti (1968)",
    IUnit: IUnit === 0 ? "SI" : "영미",
    V_fps: V,
    R_ft: R,
    Rp_ft: Rp,
    Sv_fps: Sv,
    Nu,
    T2P,
    Zv,
    Ya_ft: Ya,
    Yb_ft: Yb,
    Ap,
    K4,
    Qt_total_day: Qtd,
    Qt_total_sec: Qts,
    Ct_ppm: Ct,
    fractions: rows
  };
}

// ============================================================
// E.5 Shen & Hung (1971)
// ============================================================
export function Shen_Hung(inp: InputData) {
  const A0 = -107404.45938164;
  const A1 = 324214.74734085;
  const A2 = -326309.58908739;
  const A3 = 109503.87232539;
  const A4 = 0.00750189;
  const A5 = 0.00428802;
  const A6 = -0.00239974;

  const IUnit = inp.IUnit;
  let V_fps: number, Tdc: number;

  if (IUnit === 0) {
    const V = inp.Q / (inp.B * inp.D);
    V_fps = V / 0.3048;
    Tdc = inp.T;
  } else {
    V_fps = inp.Q / (inp.B * inp.D);
    Tdc = (inp.T - 32.0) * 5.0 / 9.0;
  }

  const Ws = FallVel(inp.D50, Tdc) / 30.48;

  const X = Math.pow(V_fps, A4) * Math.pow(inp.S, A5) * Math.pow(Ws, A6);
  const Ct = Math.pow(10.0, A0 + X * (A1 + X * (A2 + A3 * X)));
  const Cv = inp.Sg * Ct * 1.0e-6 / (inp.Sg - (inp.Sg - 1.0) * Ct * 1.0e-6);

  let Qts: number;
  let Qt: number;
  if (IUnit === 0) {
    Qts = Cv * inp.Q;
    Qt = Qts / inp.B;
  } else {
    Qts = Cv * inp.Q * Math.pow(0.3048, 3);
    Qt = Qts / (inp.B * 0.3048);
  }

  const Qtd = Qt * 86400 * (IUnit === 0 ? inp.B : inp.B * 0.3048);

  return {
    formula: "Shen & Hung (1971)",
    IUnit: IUnit === 0 ? "SI" : "영미",
    V_fps,
    Ws_fps: Ws,
    X_param: X,
    Ct_ppm: Ct,
    Cv,
    qt_sec_per_width: Qt,
    Qt_total_sec: Qts,
    Qt_total_day: Qtd,
  };
}

// ============================================================
// E.6 Ackers & White (1973)
// ============================================================
export function Ackers_White(inp: InputData) {
  const IUnit = inp.IUnit;
  let G: number, Tdc: number, Nu: number, D35: number, V: number, D: number, B: number, Q: number;

  if (IUnit === 0) {
    G = 9.8;
    Tdc = inp.T;
    Nu = visco(Tdc);
    D35 = inp.D35 / 1000.0;
    V = inp.Q / (inp.B * inp.D);
    D = inp.D; B = inp.B; Q = inp.Q;
  } else {
    G = 32.2;
    Tdc = (inp.T - 32.0) * 5.0 / 9.0;
    Nu = visco(Tdc) / Math.pow(0.3048, 2);
    D35 = inp.D35 / 304.8;
    V = inp.Q / (inp.B * inp.D);
    D = inp.D; B = inp.B; Q = inp.Q;
  }

  const SM1 = inp.Sg - 1.0;
  const Sv = Math.sqrt(G * D * inp.S);
  const Fr = V / Math.sqrt(G * D);

  const Dgr = D35 * Math.pow(G * SM1 / Math.pow(Nu, 2), 1.0 / 3.0);

  let Cc: number, Cn: number, Ca: number, Cm: number;
  if (Dgr <= 60.0) {
    const Cldgr = Math.log10(Dgr);
    Cc = Math.pow(10.0, 2.86 * Cldgr - Math.pow(Cldgr, 2) - 3.53);
    Cn = 1.0 - 0.56 * Cldgr;
    Ca = 0.23 / Math.sqrt(Dgr) + 0.14;
    Cm = 9.66 / Dgr + 1.34;
  } else {
    Cc = 0.025;
    Cn = 0.0;
    Ca = 0.17;
    Cm = 1.50;
  }

  const Fgr = (Math.pow(Sv, Cn) / Math.sqrt(G * D35 * SM1) *
               Math.pow(V / (Math.sqrt(32.0) * Math.log10(10.0 * D / D35)), 1.0 - Cn));

  if (Fgr <= Ca) {
    return {
      formula: "Ackers & White (1973)",
      IUnit: IUnit === 0 ? "SI" : "영미",
      Dgr, Fgr, Ca,
      error_info: `Fgr(${Fgr.toFixed(4)}) <= Ca(${Ca.toFixed(4)}): 한계 전단력 미달, 이송 없음`,
      qt_sec_per_width: 0.0, Qt_total_sec: 0.0,
      Qt_total_day: 0.0, Cv: 0.0, Ct_ppm: 0.0,
    };
  }

  const Ggr = Cc * Math.pow(Fgr / Ca - 1.0, Cm);
  const Cx = Ggr * inp.Sg * D35 / D * Math.pow(V / Sv, Cn);
  const Ct = Cx * 1.0e6;
  const Cv = inp.Sg * Cx / (inp.Sg - (inp.Sg - 1.0) * Cx);

  let Qts: number;
  let Qt: number;
  if (IUnit === 0) {
    Qts = Cv * Q;
    Qt = Qts / B;
  } else {
    Qts = Cv * Q * Math.pow(0.3048, 3);
    Qt = Qts / (B * 0.3048);
  }

  const Qtd = Qt * 86400 * (IUnit === 0 ? B : B * 0.3048);

  return {
    formula: "Ackers & White (1973)",
    IUnit: IUnit === 0 ? "SI" : "영미",
    V, Sv, Nu, Dgr, Cc, Cn, Ca, Cm, Fgr, Ggr, Ct_ppm: Ct, Cv,
    qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd,
    Fr_check: Fr,
    Dgr_check: Dgr >= 1.0 ? "적용 가능" : "Dgr<1.0: 결과 신뢰도 낮음",
    Fr_check_str: Fr <= 0.8 ? "적용 가능" : "Fr>0.8: 결과 신뢰도 낮음",
  };
}

// ============================================================
// E.7 Yang (1973, 1979)
// ============================================================
export function Yang(inp: InputData) {
  const IUnit = inp.IUnit;
  let G: number, SM1: number, Tdc: number, Nu: number, D50: number, B: number, D: number, Q: number, V: number, Sv: number;

  if (IUnit === 0) {
    G = 9.8; SM1 = inp.Sg - 1.0;
    Tdc = inp.T; Nu = visco(Tdc);
    D50 = inp.D50 / 1000.0;
    B = inp.B; D = inp.D; Q = inp.Q;
    V = Q / (B * D);
    const R_y = B * D / (B + 2.0 * D);
    Sv = Math.sqrt(G * R_y * inp.S);
  } else {
    G = 32.2; SM1 = inp.Sg - 1.0;
    Tdc = (inp.T - 32.0) * 5.0 / 9.0;
    Nu = visco(Tdc) / Math.pow(0.3048, 2);
    D50 = inp.D50 / 304.8;
    B = inp.B; D = inp.D; Q = inp.Q;
    V = Q / (B * D);
    const R_y = B * D / (B + 2.0 * D);
    Sv = Math.sqrt(G * R_y * inp.S);
  }

  const Ds_std = [0.0625, 0.125, 0.250, 0.500, 1.000, 2.000, 4.000, 8.000, 16.000];
  const Dm_list = Ds_std.slice(0, 8).map((d, i) => Math.sqrt(d * Ds_std[i + 1]));
  const Dm_use = IUnit === 0 ? Dm_list.map(d => d / 1000.0) : Dm_list.map(d => d / 304.8);

  const Nm = inp.ISize === 0 ? 1 : 8;
  const Dm_calc = inp.ISize === 0 ? [D50] : Dm_use;
  const Im_use = inp.ISize === 0 ? [1.0] : inp.Im;

  let Ct73 = 0.0;
  let Ct79 = 0.0;
  const rows: any[] = [];

  for (let i = 0; i < Nm; i++) {
    const Di = Dm_calc[i];
    const Ib = Im_use[i];
    if (Ib <= 0.0) continue;

    const Dmm = IUnit === 0 ? Di * 1000.0 : Di * 304.8;
    const W = IUnit === 0 ? FallVel(Dmm, Tdc) / 100.0 : FallVel(Dmm, Tdc) / 30.48;

    const Rey = Sv * Di / Nu;
    let Vcw = 2.05;
    if (Rey > 1.2 && Rey < 70.0) {
      Vcw = 2.5 / (Math.log10(Rey) - 0.06) + 0.66;
    }

    const Wdnu = W * Di / Nu;
    const Svw = W > 0 ? Sv / W : 0;

    const arg73 = V * inp.S / W - Vcw * inp.S;
    if (arg73 > 0) {
      const Lct73 = (5.435 - 0.286 * Math.log10(Wdnu) - 0.457 * Math.log10(Svw) +
                     (1.799 - 0.409 * Math.log10(Wdnu) - 0.314 * Math.log10(Svw)) * Math.log10(arg73));
      Ct73 += Math.pow(10.0, Lct73) * Ib;
    }

    const arg79 = V * inp.S / W;
    if (arg79 > 0) {
      const Lct79 = (5.165 - 0.153 * Math.log10(Wdnu) - 0.297 * Math.log10(Svw) +
                     (1.780 - 0.360 * Math.log10(Wdnu) - 0.480 * Math.log10(Svw)) * Math.log10(arg79));
      Ct79 += Math.pow(10.0, Lct79) * Ib;
    }

    rows.push({ fraction: i + 1, Di_mm: Dmm, Im: Ib, Vcw, W, note: arg73 <= 0 ? "Yang73 한계유속 미달" : "" });
  }

  const ctToDischarge = (Ct_ppm: number) => {
    const Cv = inp.Sg * Ct_ppm * 1.0e-6 / (inp.Sg - (inp.Sg - 1.0) * Ct_ppm * 1.0e-6);
    let Qts: number, Qt: number;
    if (IUnit === 0) {
      Qts = Cv * Q; Qt = Qts / B;
    } else {
      Qts = Cv * Q * Math.pow(0.3048, 3); Qt = Qts / (B * 0.3048);
    }
    const Qtd = Qt * 86400 * (IUnit === 0 ? B : B * 0.3048);
    return { Cv, Qt_total_sec: Qts, qt_sec_per_width: Qt, Qt_total_day: Qtd, Ct_ppm };
  };

  return {
    formula: "Yang (1973/1979)",
    IUnit: IUnit === 0 ? "SI" : "영미",
    Yang1973: ctToDischarge(Ct73),
    Yang1979: ctToDischarge(Ct79),
    fractions: rows
  };
}

// ============================================================
// E.8 Ranga Raju (1981)
// ============================================================
export function Ranga_Raju(inp: InputData) {
  const IUnit = inp.IUnit;
  let G: number, Nu: number, Gs: number, Gf: number, D50: number, V: number, R: number, SM1: number, Sv: number, B: number, D: number, Q: number;

  if (IUnit === 0) {
    G = 9.8; Nu = visco(inp.T); Gs = inp.Sg; Gf = 1.0;
    D50 = inp.D50 / 1000.0;
    V = inp.Q / (inp.B * inp.D); R = inp.B * inp.D / (inp.B + 2.0 * inp.D);
    SM1 = inp.Sg - 1.0; Sv = Math.sqrt(G * R * inp.S);
    B = inp.B; D = inp.D; Q = inp.Q;
  } else {
    G = 32.2; Gs = inp.Sg * 62.4 * 0.000454; Gf = 62.4 * 0.000454;
    const Tdc = (inp.T - 32.0) * 5.0 / 9.0;
    Nu = visco(Tdc) / Math.pow(0.3048, 2);
    D50 = inp.D50 / 304.8;
    V = inp.Q / (inp.B * inp.D); R = inp.B * inp.D / (inp.B + 2.0 * inp.D);
    SM1 = inp.Sg - 1.0; Sv = Math.sqrt(G * R * inp.S);
    B = inp.B; D = inp.D; Q = inp.Q;
  }

  let Rb = R;
  if (inp.ISide === 1) {
    [Rb, Sv] = SideWallCorr(B, D, Q, inp.S, inp.Sg, inp.T, G, Nu, R, SM1, Sv, V);
  }

  let Rn: number, Rbp: number;
  if (IUnit === 0) {
    Rn = Math.pow(D50, 1.0 / 6.0) / 24.0;
    Rbp = Math.pow(V * Rn / Math.sqrt(inp.S), 1.5);
  } else {
    Rn = 0.034 * Math.pow(D50, 1.0 / 6.0);
    Rbp = Math.pow(V * Rn / (Math.sqrt(inp.S) * 1.489), 1.5);
  }

  const Top = Gf * Rbp * inp.S;
  const To = Gf * Rb * inp.S;
  const Tsp = D50 > 0 ? Top / ((inp.Sg - 1.0) * D50) : 0.0;

  const Ws = (Math.sqrt(2.0 / 3.0 * G * SM1 * Math.pow(D50, 3) + 36.0 * Math.pow(Nu, 2)) - 6.0 * Nu) / D50;
  const Svw = Ws > 0 ? Sv / Ws : 0;

  let Rm = 0.0;
  if (Svw >= 0.5) Rm = 0.2 * Svw - 0.10;
  const Phit = 60.0 * Math.pow(Tsp, 3) * Math.pow(Top / To, -3.0 * Rm);

  const Qt = Phit * Gs * Math.sqrt(SM1 * G * Math.pow(D50, 3));
  const Qts = Qt * B;
  const Qtd = Qt * 86400 * B;
  const Cv = IUnit === 0 ? Qts / Q : Qts / (Q * Math.pow(0.3048, 3));
  const Ct = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1.0e6;

  return {
    formula: "Ranga Raju, Garde & Bhardwaj (1981)",
    IUnit: IUnit === 0 ? "SI" : "영미",
    V, R, Rb, Nu, Rn, Top, To, Tsp, Sv, Ws, Phit,
    qt_sec_per_width: Qt, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct
  };
}

// ============================================================
// E.9 Rijn (1984)
// ============================================================
export function Rijn(inp: InputData) {
  const Co = 0.65;
  const Kappa = 0.4;

  const IUnit = inp.IUnit;
  let G: number, Gs: number, Nu: number, D50: number, D65: number, D90: number, V: number, R: number, SM1: number, B: number, D: number, Q: number;

  if (IUnit === 0) {
    G = 9.8; Gs = inp.Sg; Nu = visco(inp.T);
    D50 = inp.D50 / 1000.0; D65 = inp.D65 / 1000.0; D90 = inp.D90 / 1000.0;
    V = inp.Q / (inp.B * inp.D); R = inp.B * inp.D / (inp.B + 2.0 * inp.D);
    SM1 = inp.Sg - 1.0;
    B = inp.B; D = inp.D; Q = inp.Q;
  } else {
    G = 32.2; Gs = inp.Sg * 62.4 * 0.000454;
    const Tdc = (inp.T - 32.0) * 5.0 / 9.0; Nu = visco(Tdc) / Math.pow(0.3048, 2);
    D50 = inp.D50 / 304.8; D65 = inp.D65 / 304.8; D90 = inp.D90 / 304.8;
    V = inp.Q / (inp.B * inp.D); R = inp.B * inp.D / (inp.B + 2.0 * inp.D);
    SM1 = inp.Sg - 1.0;
    B = inp.B; D = inp.D; Q = inp.Q;
  }

  let Sv_main = Math.sqrt(G * R * inp.S);
  const Dst = D50 * Math.pow(SM1 * G / Math.pow(Nu, 2), 1.0 / 3.0);
  const Csv = Shield(D50, G, Nu, SM1);

  if (inp.ISide === 1) {
    const [_, Sv_new] = SideWallCorr(B, D, Q, inp.S, inp.Sg, inp.T, G, Nu, R, SM1, Sv_main, V);
    Sv_main = Sv_new;
  }

  let Cp = 18.0 * Math.log10(4.0 * R / D90);
  if (IUnit === 1) Cp = Cp / 0.5521;
  const Svp = Math.sqrt(G) * V / Cp;

  const Td = Csv > 0 ? (Math.pow(Svp, 2) - Math.pow(Csv, 2)) / Math.pow(Csv, 2) : 0.0;
  if (Td < 0.0) {
    return {
      formula: "van Rijn (1984)",
      IUnit: IUnit === 0 ? "SI" : "영미",
      Dst, Csv_critical: Csv, Svp_grain: Svp, Td_transport_stage: Td,
      error_info: `Td=${Td.toFixed(4)} < 0: 임계전단속도 미달, 이송 없음`,
      Qt_total_sec: 0.0, Qt_total_day: 0.0, Cv: 0.0, Ct_ppm: 0.0,
    };
  }

  let Ad = inp.Delta * 0.5;
  if (Ad <= 0.0) Ad = D65;
  if (Ad < 0.01 * D) Ad = 0.01 * D;

  const Ca = (Ad > 0 && Dst > 0) ? 0.015 * D50 * Math.pow(Td, 1.5) / (Ad * Math.pow(Dst, 0.3)) : 0.0;
  const Ds = D50 * (1.0 + 0.011 * (inp.Grd - 1.0) * (Td - 25.0));

  const Ds_mm = IUnit === 0 ? Ds * 1000.0 : Ds * 304.8;
  let Ws: number;
  if (Ds_mm <= 0.1) {
    Ws = SM1 * G * Math.pow(Ds, 2) / (18.0 * Nu);
  } else if (Ds_mm <= 1.0) {
    Ws = (10.0 * Nu / Ds * (Math.sqrt(1.0 + 0.01 * SM1 * G * Math.pow(Ds, 3) / Math.pow(Nu, 2)) - 1.0));
  } else {
    Ws = 1.1 * Math.sqrt(SM1 * G * Ds);
  }

  const Beta = 1.0 + 2.0 * Math.pow(Ws / Sv_main, 2);
  const Phi = 2.5 * Math.pow(Ws / Sv_main, 0.8) * Math.pow(Ca / Co, 0.4);
  const Z = (Beta * Kappa * Sv_main) > 0 ? Ws / (Beta * Kappa * Sv_main) : 0.0;
  const Zp = Z + Phi;
  const F_val = Math.abs(1.2 - Zp) > 1e-8 ? (Math.pow(Ad / D, Zp) - Math.pow(Ad / D, 1.2)) / (Math.pow(1.0 - Ad / D, Zp) * (1.2 - Zp)) : 0.0;

  const Qb_vol = 0.053 * Math.pow(Td, 2.1) / Math.pow(Dst, 0.3) * Math.sqrt(SM1 * G * Math.pow(D50, 3));
  const Qs_vol = F_val * V * D * Ca;
  const Qt_vol = Qb_vol + Qs_vol;

  const Qt_w = Qt_vol * Gs;
  const Qts = Qt_w * B;
  const Qtd = Qt_w * 86400 * B;
  const Cv = IUnit === 0 ? Qts / Q : Qts / (Q * Math.pow(0.3048, 3));
  const Ct = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0) * Cv) * 1.0e6;

  return {
    formula: "van Rijn (1984)",
    IUnit: IUnit === 0 ? "SI" : "영미",
    V, R, Nu, Dst, Sv_shear: Sv_main, Csv_critical: Csv, Cp_Chezy: Cp, Svp_grain: Svp, Td_transport_stage: Td,
    Ad_ref_height: Ad, Ca_ref_conc: Ca, Ds_repr_dia: Ds, Ws_fall_vel: Ws, Beta, Phi, Z_susp_num: Z, Zp, F_factor: F_val,
    qb_bed_load_vol: Qb_vol, qs_susp_load_vol: Qs_vol, qt_total_vol: Qt_vol, Qt_total_sec: Qts, Qt_total_day: Qtd, Cv, Ct_ppm: Ct
  };
}

// ============================================================
// 파일 파서 (Sediment.Dat 형식)
// ============================================================

/**
 * Sediment.Dat 형식의 텍스트 데이터를 파싱하여 InputData 객체 리스트 반환
 */
export function parseSedimentDat(content: string): InputData[] {
  const lines = content.split(/\r?\n/);
  const inputs: InputData[] = [];
  let i = 0;

  while (i < lines.length) {
    const title = lines[i].trim();
    if (!title) { i++; continue; }
    i++;

    if (i >= lines.length) break;
    const line2 = lines[i].trim().split(/\s+/);
    const IUnit = parseInt(line2[0]);
    const ISize = parseInt(line2[1]);
    const ISide = parseInt(line2[2]);
    i++;

    if (i >= lines.length) break;
    const line3 = lines[i].trim().split(/\s+/);
    const B = parseFloat(line3[0]);
    const D = parseFloat(line3[1]);
    const Q = parseFloat(line3[2]);
    const S = parseFloat(line3[3]);
    i++;

    if (i >= lines.length) break;
    const line4 = lines[i].trim().split(/\s+/);
    const T = parseFloat(line4[0]);
    const Bedform = line4[1] || "평탄하상";
    i++;

    if (i >= lines.length) break;
    const line5 = lines[i].trim().split(/\s+/);
    const D35 = parseFloat(line5[0]);
    const D50 = parseFloat(line5[1]);
    const D65 = parseFloat(line5[2]);
    const D90 = parseFloat(line5[3]);
    i++;

    if (i >= lines.length) break;
    const line6 = lines[i].trim().split(/\s+/);
    const Sg = parseFloat(line6[0]);
    const Grd = parseFloat(line6[1]);
    const Delta = parseFloat(line6[2]);
    i++;

    let Im = [0, 0, 0, 0, 0, 0, 0, 0];
    if (ISize === 1) {
      if (i >= lines.length) break;
      const line7 = lines[i].trim().split(/\s+/);
      Im = line7.map(v => parseFloat(v));
      i++;
    }

    inputs.push({
      Title: title,
      IUnit, ISize, ISide,
      B, D, Q, S,
      T, Bedform,
      D35, D50, D65, D90,
      Sg, Grd, Delta,
      Im
    });
  }

  return inputs;
}

// ============================================================
// 파일 포맷팅 (입력/출력 파일 생성용)
// ============================================================

/**
 * InputData 객체를 Sediment.Dat 형식의 문자열로 변환
 */
export function formatSedimentInput(inp: InputData): string {
  let s = `${inp.Title}\n`;
  s += `${inp.IUnit} ${inp.ISize} ${inp.ISide}\n`;
  s += `${inp.B.toFixed(3)} ${inp.D.toFixed(3)} ${inp.Q.toFixed(3)} ${inp.S.toFixed(6)}\n`;
  s += `${inp.T.toFixed(1)} ${inp.Bedform}\n`;
  s += `${inp.D35.toFixed(4)} ${inp.D50.toFixed(4)} ${inp.D65.toFixed(4)} ${inp.D90.toFixed(4)}\n`;
  s += `${inp.Sg.toFixed(3)} ${inp.Grd.toFixed(3)} ${inp.Delta.toFixed(3)}\n`;
  if (inp.ISize === 1 && inp.Im) {
    s += inp.Im.map(v => v.toFixed(4)).join(' ') + '\n';
  }
  return s;
}

/**
 * 산정 결과를 상세 출력 형식의 문자열로 변환 (원본 프로그램 양식 모사)
 */
export function formatSedimentOutput(inp: InputData, results: any): string {
  let s = "============================================================\n";
  s += "      SEDIMENT TRANSPORT CALCULATION DETAILED REPORT\n";
  s += "============================================================\n\n";

  s += "[INPUT DATA SUMMARY]\n";
  s += `Title: ${inp.Title}\n`;
  s += `Unit: ${inp.IUnit === 0 ? 'SI' : 'English'} | Size Mode: ${inp.ISize === 0 ? 'Single' : 'Fractional'} | Side Wall: ${inp.ISide === 0 ? 'No' : 'Yes'}\n`;
  s += `B: ${inp.B.toFixed(2)} m | D: ${inp.D.toFixed(2)} m | Q: ${inp.Q.toFixed(2)} m3/s | S: ${inp.S.toFixed(6)}\n`;
  s += `Temp: ${inp.T.toFixed(1)} C | Bedform: ${inp.Bedform}\n`;
  s += `D35: ${inp.D35.toFixed(3)} mm | D50: ${inp.D50.toFixed(3)} mm | D65: ${inp.D65.toFixed(3)} mm | D90: ${inp.D90.toFixed(3)} mm\n`;
  s += `Sg: ${inp.Sg.toFixed(2)} | Grd: ${inp.Grd.toFixed(2)} | Delta: ${inp.Delta.toFixed(2)}\n\n`;

  s += "------------------------------------------------------------\n";
  s += "   FORMULA NAME        TOTAL LOAD (ton/day)    CONC (ppm)\n";
  s += "------------------------------------------------------------\n";

  const addLine = (name: string, res: any) => {
    if (!res || res.error) {
      s += `${name.padEnd(20)} ERROR: ${res?.error || 'N/A'}\n`;
      return;
    }
    const qt = res.Qt_total_day || (res.Yang1973 ? res.Yang1973.Qt_total_day : 0);
    const ct = res.Ct_ppm || (res.Yang1973 ? res.Yang1973.Ct_ppm : 0);
    s += `${name.padEnd(20)} ${qt.toFixed(4).padStart(15)} ${ct.toFixed(4).padStart(15)}\n`;
    
    if (res.Yang1979) {
      s += `${(name + " (1979)").padEnd(20)} ${res.Yang1979.Qt_total_day.toFixed(4).padStart(15)} ${res.Yang1979.Ct_ppm.toFixed(4).padStart(15)}\n`;
    }
  };

  addLine("Einstein", results.Einstein);
  addLine("Colby", results.Colby);
  addLine("Engelund-Hansen", results.Engelund_Hansen);
  addLine("Toffaleti", results.Toffaleti);
  addLine("Shen-Hung", results.Shen_Hung);
  addLine("Ackers-White", results.Ackers_White);
  addLine("Yang", results.Yang);
  addLine("Ranga Raju", results.Ranga_Raju);
  addLine("van Rijn", results.Rijn);

  s += "------------------------------------------------------------\n";
  s += "\n[END OF REPORT]\n";
  return s;
}

/**
 * 특정 공식 하나의 결과만 출력하는 형식 (원본 프로그램 개별 출력 모사)
 */
export function formatSingleFormulaOutput(inp: InputData, formulaName: string, res: any): string {
  let s = "============================================================\n";
  s += `      SEDIMENT TRANSPORT REPORT: ${formulaName.toUpperCase()}\n`;
  s += "============================================================\n\n";

  s += "[INPUT DATA]\n";
  s += `Title: ${inp.Title}\n`;
  s += `B: ${inp.B.toFixed(3)} | D: ${inp.D.toFixed(3)} | Q: ${inp.Q.toFixed(3)} | S: ${inp.S.toFixed(6)}\n`;
  s += `D50: ${inp.D50.toFixed(4)} | Sg: ${inp.Sg.toFixed(3)} | Temp: ${inp.T.toFixed(1)}\n\n`;

  s += "------------------------------------------------------------\n";
  s += "   RESULT SUMMARY\n";
  s += "------------------------------------------------------------\n";

  if (!res || res.error) {
    s += `Status: ERROR\nMessage: ${res?.error || 'Calculation failed'}\n`;
  } else {
    const qt = res.Qt_total_day !== undefined ? res.Qt_total_day : (res.Yang1973 ? res.Yang1973.Qt_total_day : 0);
    const ct = res.Ct_ppm !== undefined ? res.Ct_ppm : (res.Yang1973 ? res.Yang1973.Ct_ppm : 0);
    
    s += `Total Load: ${qt.toFixed(6)} ton/day\n`;
    s += `Concentration: ${ct.toFixed(6)} ppm\n`;

    if (res.Yang1979) {
      s += "\n[Yang 1979 Variation]\n";
      s += `Total Load: ${res.Yang1979.Qt_total_day.toFixed(6)} ton/day\n`;
      s += `Concentration: ${res.Yang1979.Ct_ppm.toFixed(6)} ppm\n`;
    }
  }

  s += "------------------------------------------------------------\n";
  return s;
}

// ============================================================
// 통합 실행 함수
// ============================================================
export function runAll(inp: InputData, formulas?: string[]) {
  const allFormulas: { [key: string]: (inp: InputData) => any } = {
    'Einstein': Einstein,
    'Colby': Colby,
    'Engelund_Hansen': Engelund_Hansen,
    'Toffaleti': Toffaleti,
    'Shen_Hung': Shen_Hung,
    'Ackers_White': Ackers_White,
    'Yang': Yang,
    'Ranga_Raju': Ranga_Raju,
    'Rijn': Rijn,
  };

  const selectedFormulas = formulas || Object.keys(allFormulas);
  const results: { [key: string]: any } = {};

  for (const name of selectedFormulas) {
    if (allFormulas[name]) {
      try {
        results[name] = allFormulas[name](inp);
      } catch (e: any) {
        results[name] = { error: e.message };
      }
    }
  }
  return results;
}
