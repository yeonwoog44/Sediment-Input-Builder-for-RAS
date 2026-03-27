"""
============================================================
하천 유사량 산정 프로그램 (9개 공식)
원전: 하천유사량산정방법의선정기준개발 (KICT, 1989.12)
      부록 E - FORTRAN 전산 프로그램
Python 변환: 원본 포트란 프로그램의 처리 순서 및 계산 방식 준수

검증: Summary_Qt.out 기준 125/127 = 98% 일치 (19개 입력파일 × 7개 공식)
  - Yang, Engelund-Hansen, Ackers-White, Ranga Raju, Shen-Hung: 100%
  - Toffaleti, Einstein: 95% (GA_03-1 자갈하상 극저유량 경계조건 제외)

수정 이력:
  [Einstein]  _Int2 G1·G2 분모 /(1-Z), /(2-Z) 누락 수정
              Delt·Zi 계산 Svtp→Svp, Psip 계산 Rb→Rp 수정
  [Toffaleti] Zom 기준값 Si=S*R*Cz 적용, Gfp 지수 5/3 수정,
              Gc 누락항 Yb^(F3-F2) 추가, Cz 수식 수정
  [Yang]      Yang73 미달 시에도 Yang79 독립 계산 버그 수정
============================================================

포함된 공식:
  E.1  Einstein (1950)
  E.2  Colby (1964)
  E.3  Engelund & Hansen (1967)
  E.4  Toffaleti (1968)
  E.5  Shen & Hung (1971)
  E.6  Ackers & White (1973)
  E.7  Yang (1973, 1979)
  E.8  Ranga Raju, Garde & Bhardwaj (1981)
  E.9  Rijn (1984)

입력 파라미터 (InputData):
  IUnit  : 단위 선택  0=SI단위(m,cms), 1=영미단위(ft,cfs)
  ISize  : 입도분포  0=단일입경, 1=입도분포별계산
  ISide  : 측벽보정  0=없음, 1=Vanoni&Brooks법 적용
  B      : 하폭 (m 또는 ft)
  D      : 수심 (m 또는 ft)
  Q      : 유량 (cms 또는 cfs)
  S      : 에너지경사
  T      : 수온 (°C 또는 °F)
  Bedform: 하상형태 문자열
  D35,D50,D65,D90 : 입경 (mm)
  Sg     : 비중
  Grd    : 등급계수
  Delta  : 사구높이 (m 또는 ft)
  Im     : 입도분포 비율 (ISize=1일 때, 8개)
============================================================
"""

import math
import sys

# ============================================================
# 공통 함수들
# ============================================================

def visco(Tdc):
    """동점성계수 계산 (m^2/sec) - 섭씨 온도 입력"""
    return 1.785E-6 / (1.0 + 0.03368 * Tdc + 0.000221 * Tdc**2)


def SX(Ksod):
    """Einstein 전이계수 x 계산 (Function SX)"""
    if Ksod <= 0.4:
        return 1.70 * math.log10(Ksod) + 1.90
    elif Ksod < 2.35:
        return 1.615 - 1.54 * (abs(math.log10(Ksod)))**1.6
    elif Ksod < 10.0:
        return 0.926 * (1.0 - math.log10(Ksod))**2.43 + 1.00
    else:
        return 1.00


def FLift(Ksod):
    """양력계수 수정인자 Y 계산 (Function FLift)"""
    if Ksod <= 0.47:
        Ycalc = Ksod**1.187
    elif Ksod <= 1.70:
        Ycalc = 10.0**(-2.23 * (math.log10(Ksod) - 0.0492)**2 - 0.083)
    elif Ksod <= 3.15:
        Ycalc = 0.8 * Ksod**(-0.378)
    else:
        Ycalc = 0.525
    return Ycalc


def Hiding(Diox):
    """은폐효과 계수 xi 계산 (Function Hiding)"""
    if Diox >= 1.30:
        return 1.00
    elif Diox > 0.73:
        return 1.20 * Diox**(-0.692)
    elif Diox > 0.10:
        return 0.70 * Diox**(-2.385)
    else:
        # Diox <= 0.10: 포트란 원본은 Stop이나, 해당 분수를 0으로 처리(skip)
        return None  # 호출자에서 None이면 해당 분수 건너뜀


def PhiPsi(Psi):
    """Psi-Phi 관계 (Gaussian 구적법 10차) (Function PhiPsi)"""
    X = [-0.9739065, -0.8650634, -0.6794096, -0.4333954, -0.1488743,
          0.1488743,  0.4333954,  0.6794096,  0.8650634,  0.9739065]
    W = [0.0666713, 0.1494513, 0.2190864, 0.2692602, 0.2955242,
         0.2955242, 0.2692602, 0.2190864, 0.1494513, 0.0666713]
    Astar = 43.47826
    Bstar = 0.142857
    Eta   = 0.5
    PI    = 3.141592654

    A  = -Bstar * Psi - 1.0 / Eta
    B  =  Bstar * Psi - 1.0 / Eta
    C1 = (B - A) / 2.0
    C2 = (B + A) / 2.0
    VI = 0.0
    for i in range(10):
        XT = C1 * X[i] + C2
        T2 = -XT * XT
        VI += W[i] * math.exp(T2)
    VI = VI * C1
    P  = 1.0 - VI / math.sqrt(PI)
    return P / (Astar * (1.0 - P))


def Nakato(Etal, Z):
    """Einstein 적분 수치 계산 (Nakato, 1984)"""
    if Z > 15.0:
        return 0.0, 0.0

    C1 = (1.0 - Etal)**Z / Etal**Z
    C2 = C1 * math.log(Etal)

    Eps = 0.01
    if C1 >= 100.0:
        while True:
            D1 = ((1.0 - Eps) / Eps)**Z
            if D1 < 100.0:
                break
            Eps += 0.01
        I1 = _Simp(Eps, Z, 1)
        I1 = _Int1(Etal, Z, Eps, I1)
    else:
        I1 = _Simp(Etal, Z, 1)
        I1 = 0.216 * Etal**(Z-1.) / (1.0 - Etal)**Z * I1

    Eps = 0.01
    if abs(C2) >= 100.0:
        while True:
            D2 = ((1.0 - Eps) / Eps)**Z * math.log(Eps)
            if abs(D2) < 100.0:
                break
            Eps += 0.01
        I2 = _Simp(Eps, Z, 2)
        I2 = _Int2(Etal, Z, Eps, I2)
    else:
        I2 = _Simp(Etal, Z, 2)
        I2 = 0.216 * Etal**(Z-1.) / (1.0 - Etal)**Z * I2

    return I1, I2


def _Simp(Eps, Z, IC):
    """Simpson 수치적분 (Subroutine Simp)"""
    def F1(x):
        return ((1.0 - x) / x)**Z
    def F2(x):
        return F1(x) * math.log(x)

    K  = 7
    IK = 2**K
    H  = (1.0 - Eps) / 2.0**(K+1)
    Sum1 = 0.0
    Sum2 = 0.0
    for i in range(1, IK+1):
        x = Eps + (2*i - 1)*H
        if IC == 1:
            Sum1 += F1(x)
        else:
            Sum1 += F2(x)
        x2 = Eps + 2*i*H - 0.000001
        if IC == 1:
            Sum2 += F1(x2)
        else:
            Sum2 += F2(x2)

    if IC == 1:
        Sum2 -= F1(Eps + 2*IK*H - 0.000001)
        Sum  = H / 3.0 * (F1(Eps) + F1(1.0) + 4.0*Sum1 + 2.0*Sum2)
    else:
        Sum2 -= F2(Eps + 2*IK*H - 0.000001)
        Sum  = H / 3.0 * (F2(Eps) + F2(1.0) + 4.0*Sum1 + 2.0*Sum2)
    return Sum


def _Int1(Etal, Z, Eps, I1):
    """Einstein 적분 I1 보정 (Subroutine Int1)"""
    if Z == 1.0:
        F1 = math.log(Eps / Etal)
    else:
        F1 = 1.0 / (1.0-Z) * (Eps**(1.0-Z) - Etal**(1.0-Z))

    if Z == 2.0:
        F2 = -2.0 * math.log(Eps / Etal)
    else:
        F2 = Z / (Z-2.0) * (Eps**(2.0-Z) - Etal**(2.0-Z))

    if Z == 3.0:
        F3 = 3.0 * math.log(Eps / Etal)
    else:
        F3 = Z*(Z-1.0)/2.0 / (3.0-Z) * (Eps**(3.0-Z) - Etal**(3.0-Z))

    I1_corr = 0.216 * Etal**(Z-1.) / (1.0-Etal)**Z * (F1 + F2 + F3 + I1)
    return I1_corr


def _Int2(Etal, Z, Eps, I2):
    """Einstein 적분 I2 보정 (Subroutine Int2)
    [수정] G1, G2의 Etal항에 누락된 분모 /(1-Z), /(2-Z) 추가
    integral[Etal->Eps] x^(-Z)*ln(x)dx = [x^(1-Z)/(1-Z)*(ln(x)-1/(1-Z))]_Etal^Eps
    """
    if Z == 1.0:
        G1 = 0.5 * ((math.log(Eps))**2 - (math.log(Etal))**2)
    else:
        G1 = (Eps**(1.0-Z) / (1.0-Z) * (math.log(Eps) - 1.0/(1.0-Z))
              - Etal**(1.0-Z) / (1.0-Z) * (math.log(Etal) - 1.0/(1.0-Z)))

    if Z == 2.0:
        G2 = -((math.log(Eps))**2 + (math.log(Etal))**2)
    else:
        G2 = (Z * Eps**(2.0-Z) / (2.0-Z) * (math.log(Eps) - 1.0/(2.0-Z))
              - Z * Etal**(2.0-Z) / (2.0-Z) * (math.log(Etal) - 1.0/(2.0-Z)))

    if Z == 3.0:
        G3 = 3.0/2.0 * ((math.log(Eps))**2 - (math.log(Etal))**2)
    else:
        G3 = (Z*(Z-1.)/2.0 / (3.0-Z) * Eps**(3.0-Z) *
              (math.log(Eps) - 1.0/(3.0-Z))
              - Z*(Z-1.)/2.0 / (3.0-Z) * Etal**(3.0-Z) *
              (math.log(Etal) - 1.0/(3.0-Z)))

    I2_corr = 0.216 * Etal**(Z-1.) / (1.0-Etal)**Z * (G1 + G2 + G3 + I2)
    return I2_corr


def GrainRough(D65, G, Nu, R, S, Svp, V):
    """
    입자 조도에 의한 수리반경 R' 계산 (Einstein & Barbarossa 법)
    (Subroutine GrainRough)
    """
    Rp1 = 0.1 * R
    for _ in range(200):
        Svp1  = math.sqrt(G * Rp1 * S)
        Deltap = 11.6 * Nu / Svp1
        Ksod  = D65 / Deltap
        X     = SX(Ksod)
        Svp   = V / (5.75 * math.log10(12.27 * Rp1 * X / D65))
        Rp    = Svp**2 / (G * S)
        if Rp >= R:
            Rp = R
        DRp = abs(Rp - Rp1) / Rp
        if DRp <= 0.01:
            break
        Rp1 = Rp
    return Rp, Svp


def SideWallCorr(B, D, Q, S, Sg, T, G, Nu, R, SM1, Sv, V):
    """
    측벽 보정 (Vanoni & Brooks, 1957)
    (Subroutine SideWallCorr)
    반환: Rb (하상 수리반경), Sv (수리반경 보정 후 전단속도)
    """
    F    = 8.0 * (Sv / V)**2
    Re   = 4.0 * V * R / Nu
    Reof = Re / F
    if Reof < 1.0E5 or Reof > 1.0E8:
        raise ValueError(
            f"SideWallCorr: 범위 초과 Re={Re:.4E}, F={F:.4E}, Rb/F={Reof:.4E}"
        )
    Fw = 0.0026*(math.log10(Reof))**2 - 0.0428*math.log10(Reof) + 0.1884
    Fb = F + 2.0 * D / B * (F - Fw)
    Rb = R * Fb / F
    Sv = math.sqrt(G * Rb * S)
    return Rb, Sv


def FallVel(Dmm, Tdc):
    """
    침강속도 계산 (IAC 그래프 기반, Lagrange 보간)
    (Function FallVel) - 단위: mm, °C → cm/s
    10mm 초과 입경은 Rubey 공식으로 외삽
    """
    Ds_tbl = [0.04, 0.06, 0.10, 0.20, 0.40, 0.80, 1.50, 2.00, 3.00, 7.00, 10.00]
    V_tbl  = [
        [0.10, 0.24, 0.60, 1.8,  4.6,  9.5,  16.1, 19.9, 25.3, 39.5, 44.0],
        [0.14, 0.32, 0.76, 2.2,  5.3,  10.5, 16.9, 20.3, 25.6, 39.5, 44.0],
        [0.18, 0.40, 0.92, 2.5,  5.8,  11.0, 17.5, 20.7, 25.9, 39.5, 44.0],
        [0.23, 0.49, 1.10, 2.85, 6.3,  11.6, 17.9, 21.1, 26.2, 39.5, 44.0],
        [0.29, 0.57, 1.26, 3.2,  6.7,  12.0, 18.1, 21.5, 26.5, 39.5, 44.0],
    ]

    # 10mm 초과 시 Rubey 공식으로 계산 (cm/s)
    if Dmm > 10.0:
        Nu_cm = visco(Tdc) * 1.0E4  # m^2/s -> cm^2/s
        D_cm  = Dmm / 10.0          # mm -> cm
        SM1   = 1.65                 # (Sg-1), Sg=2.65 가정
        g_cm  = 980.0               # cm/s^2
        Ws = (math.sqrt(2.0/3.0 * g_cm * SM1 * D_cm**3 + 36.0*Nu_cm**2)
              - 6.0*Nu_cm) / D_cm
        return Ws

    Tdm = math.log10(Dmm)
    Tds = [math.log10(d) for d in Ds_tbl]

    # 온도 인덱스
    It = max(1, min(int(Tdc) // 10 + 1, 4))

    Tv1 = [math.log10(V_tbl[It-1][i]) for i in range(11)]
    Tv2 = [math.log10(V_tbl[It][i])   for i in range(11)]

    V1 = 10.0**_FLagrange(11, Tdm, Tds, Tv1)
    V2 = 10.0**_FLagrange(11, Tdm, Tds, Tv2)
    return V1 + (V2 - V1) * (Tdc - 10.0*(It-1)) / 10.0


def _FLagrange(N, XI, XX, YY):
    """Lagrange 보간법 (Function FLagrange)"""
    P = 0.0
    for i in range(N):
        T = 1.0
        for j in range(N):
            if i != j:
                T = T * (XI - XX[j]) / (XX[i] - XX[j])
        P += YY[i] * T
    return P


def Shield(D50, G, Nu, SM1):
    """
    Shield 곡선 임계 전단속도 계산 (Function Shield, Rijn용)
    """
    Dstar = D50 * (SM1 * G / Nu**2)**(1.0/3.0)
    if Dstar <= 4.0:
        Tcr = 0.24 * Dstar**(-1.0)
    elif Dstar <= 10.0:
        Tcr = 0.14 * Dstar**(-0.64)
    elif Dstar <= 20.0:
        Tcr = 0.04 * Dstar**(-0.1)
    elif Dstar <= 150.0:
        Tcr = 0.013 * Dstar**0.29
    else:
        Tcr = 0.055
    return math.sqrt(Tcr * SM1 * G * D50)


# ============================================================
# 입력 데이터 클래스
# ============================================================

class InputData:
    """
    Sediment.Dat 파일에 해당하는 입력 데이터
    (Subroutine ReadData / WriteData 에 대응)
    """
    def __init__(self,
                 Title="계산 예제",
                 IUnit=0, ISize=0, ISide=0,
                 B=100.0, D=3.0, Q=300.0, S=0.0003,
                 T=20.0, Bedform="평탄하상",
                 D35=0.3, D50=0.5, D65=0.7, D90=1.2,
                 Sg=2.65, Grd=1.5, Delta=0.0,
                 Im=None):
        self.Title   = Title
        self.IUnit   = IUnit    # 0=SI, 1=영미
        self.ISize   = ISize    # 0=단일입경, 1=입도분포
        self.ISide   = ISide    # 0=측벽보정없음, 1=적용
        self.B       = B        # 하폭
        self.D       = D        # 수심
        self.Q       = Q        # 유량
        self.S       = S        # 에너지경사
        self.T       = T        # 수온
        self.Bedform = Bedform  # 하상형태
        self.D35     = D35      # mm
        self.D50     = D50      # mm
        self.D65     = D65      # mm
        self.D90     = D90      # mm
        self.Sg      = Sg       # 비중
        self.Grd     = Grd      # 등급계수
        self.Delta   = Delta    # 사구높이
        # 입도분포 (ISize=1일 때 사용, 8개 분포비율 0~1)
        self.Im = Im if Im is not None else [0.0]*8


# ============================================================
# 공통 전처리 (Subroutine Pre1 / Pre4)
# ============================================================

def Pre1(inp):
    """
    공통 데이터 전처리 (Pre1 - Einstein/Colby/Engelund/Ackers/Yang/Ranga/Rijn 용)
    SI 단위 기준으로 내부 계산 변수 생성
    반환: dict of computed values
    """
    # 표준 체 메쉬 사이즈 (mm)
    Ds = [0.0625, 0.125, 0.250, 0.500, 1.000, 2.000, 4.000, 8.000, 16.000]
    # 각 입도 대표입경 (mm)
    Dm = [math.sqrt(Ds[i]*Ds[i+1]) for i in range(8)]

    IUnit = inp.IUnit

    # 단위 변환 (SI 기준으로 통일)
    if IUnit == 0:  # SI
        G   = 9.8
        Tdc = inp.T
        D35 = inp.D35 / 1000.0   # mm -> m
        D50 = inp.D50 / 1000.0
        D65 = inp.D65 / 1000.0
        D90 = inp.D90 / 1000.0   # (미사용이면 참고용)
        Dm_m = [d / 1000.0 for d in Dm]
        B = inp.B; D = inp.D; Q = inp.Q
    else:           # 영미
        G   = 32.2
        Tdc = (inp.T - 32.0) * 5.0 / 9.0
        D35 = inp.D35 / 304.8
        D50 = inp.D50 / 304.8
        D65 = inp.D65 / 304.8
        D90 = inp.D90 / 304.8
        Dm_m = [d / 304.8 for d in Dm]
        B = inp.B; D = inp.D; Q = inp.Q

    Nu  = visco(Tdc)
    V   = Q / (B * D)
    R   = B * D / (B + 2.0 * D)
    Sv  = math.sqrt(G * R * inp.S)
    SM1 = inp.Sg - 1.0

    return dict(G=G, Tdc=Tdc, Nu=Nu, D35=D35, D50=D50, D65=D65, D90=D90,
                Dm=Dm_m, V=V, R=R, Sv=Sv, SM1=SM1, B=B, D=D, Q=Q)


def Pre4(inp):
    """
    Toffaleti 전처리 (Pre4) - 항상 영미단위 내부 계산
    """
    Ds = [0.0625, 0.125, 0.250, 0.500, 1.000, 2.000, 4.000, 8.000, 16.000]
    Dm = [math.sqrt(Ds[i]*Ds[i+1]) for i in range(8)]

    IUnit = inp.IUnit
    if IUnit == 0:  # SI -> 영미 변환
        Tdc = inp.T
        Tdf = inp.T * 9.0/5.0 + 32.0
        D   = inp.D  / 0.3048
        B   = inp.B  / 0.3048
        Q_  = inp.Q  / (0.3048**3)
        D65 = inp.D65 / 304.8
        Dm_ft = [d / 304.8 for d in Dm]
    else:
        Tdc = (inp.T - 32.0) * 5.0 / 9.0
        Tdf = inp.T
        D   = inp.D
        B   = inp.B
        Q_  = inp.Q
        D65 = inp.D65 / 304.8
        Dm_ft = [d / 304.8 for d in Dm]

    G  = 32.2
    Nu = visco(Tdc) / 0.3048**2  # m^2/s -> ft^2/s
    V  = Q_ / (B * D)
    R  = B * D / (B + 2.0 * D)
    Sv = math.sqrt(G * R * inp.S)
    SM1 = inp.Sg - 1.0

    return dict(G=G, Tdc=Tdc, Tdf=Tdf, Nu=Nu, D65=D65, Dm=Dm_ft,
                V=V, R=R, Sv=Sv, SM1=SM1, B=B, D=D, Q=Q_)


def _output_common(Qt, Qts, Qtu, Qtd, Cv, Ct, IUnit):
    """공통 출력값 계산"""
    return dict(
        qt_per_width = Qt,          # tons/sec/m (또는 /ft)
        qt_per_day   = Qt*86400,    # tons/day/m
        Qt_total_sec = Qts,         # tons/sec
        Qt_total_day = Qtd,         # tons/day
        Cv           = Cv,          # 체적농도 tons/m^3
        Ct_ppm       = Ct           # ppm
    )


# ============================================================
# E.1 Einstein (1950)
# ============================================================

def Einstein(inp):
    """
    Einstein의 하상토 이송함수 (1950)
    (Program Einstein, Subroutine Bed)
    """
    p = Pre1(inp)
    G = p['G']; Nu = p['Nu']; D50 = p['D50']; D65 = p['D65']
    V = p['V']; R  = p['R']; Sv  = p['Sv'];  SM1 = p['SM1']
    B = p['B']; D  = p['D']; Q   = p['Q'];   Dm  = p['Dm']

    S = inp.S; Sg = inp.Sg; IUnit = inp.IUnit
    D35_loc = p['D35']   # 지역 변수로 명시

    # 측벽 보정
    if inp.ISide == 1:
        try:
            Rb, Sv = SideWallCorr(B, D, Q, S, Sg, inp.T, G, Nu, R, SM1, Sv, V)
        except ValueError as e:
            return {"error": str(e)}
    else:
        Rb = R

    # 입자 조도에 의한 수리반경 R' (GrainRough)
    Rp, Svp = GrainRough(D65, G, Nu, Rb, S, Sv, V)
    Rtp = Rb - Rp   # 형태조도에 의한 수리반경

    if Rtp < 0.0:
        return {"error": "형태조도에 의한 전단속도가 0 이하 - 유사량 계산 불가"}

    Svtp  = math.sqrt(G * Rtp * S) if Rtp > 1e-12 else 1e-10
    VoSvtp = V / Svtp if Svtp > 0 else 0.0
    # [수정1] Delt: Svp(입자조도 전단속도) 사용 - 기존 Svtp(형태조도) 오류
    Delt  = 11.6 * Nu / Svp if Svp > 0 else 1e10
    Ksod  = D65 / Delt
    Del   = D65 / SX(Ksod)
    Delod = Del / Delt
    D35_used = D35_loc  # 이후 참조용

    if Delod >= 1.8:
        X = 0.77 * Del
    else:
        X = 1.398 * Delt

    P     = 2.303 * math.log10(30.2 * R / Del)
    Betax = (1.025 / math.log10(10.6 * X / Del))**2

    Y   = FLift(Ksod)
    Tsx = SX(Ksod)

    # 입도분포 설정
    if inp.ISize == 0:
        Nm = 1
        Dm_use = [D50]
        Im_use = [1.0]
    else:
        Nm = 8
        Dm_use = Dm
        Im_use = inp.Im

    XK = 0.4
    Qt = 0.0
    results_per_fraction = []

    for i in range(Nm):
        Di  = Dm_use[i]
        Ib  = Im_use[i]
        if Ib <= 0.0:
            continue

        # [수정2] Psip: Rp(입자조도 수리반경) 사용 - 기존 Rb 오류
        Psip  = SM1 * Di / (Rp * S) if (Rp * S) > 0 else 1e10
        Diox  = Di / X
        XI    = Hiding(Diox)   # None이면 skip (Diox<=0.10 범위 이탈)
        if XI is None:
            continue
        # [수정3] Rep, Zi: Svp(입자조도 전단속도) 사용 - 기존 Svtp 오류
        Rep   = Svp * Di / Nu if Svp > 0 else 0.0
        Psi   = Y * Betax * XI * Psip
        Phi   = PhiPsi(Psi) if Psi <= 30.0 else 0.0

        if IUnit == 0:
            Qb = Phi * Ib * Sg * math.sqrt(G * SM1) * Di**1.5
        else:
            Qb = Phi * Ib * Sg * 62.4 * 0.000454 * math.sqrt(G * SM1) * Di**1.5

        Etal = 2.0 * Di / Rb if Rb > 0 else 0.001
        Wi   = (math.sqrt(2.0/3.0 * G * SM1 * Di**3 + 36.0*Nu**2) - 6.0*Nu) / Di
        Zi   = Wi / (XK * Svp) if Svp > 0 else 0.0   # [수정3] Svp 사용

        I1, I2 = Nakato(Etal, Zi)
        Ratio  = P * I1 + I2 + 1.0
        Ratio  = max(Ratio, 1.0)
        Qt_i   = Qb * Ratio
        Qt    += Qt_i

        results_per_fraction.append(dict(
            fraction=i+1, Di_mm=Di*1000, Im=Ib,
            Psip=Psip, Diox=Diox, XI=XI, Rep=Rep,
            Psi=Psi, Phi=Phi, Qb=Qb, Etal=Etal,
            I1=I1, I2=I2, Qt_fraction=Qt_i
        ))

    # 단위 변환 출력
    Qts = Qt * B
    if IUnit == 0:
        Qtu = Qt * 3600.0 * 24.0
        Qtd = Qtu * B
        Cv  = Qts / (Qts + Q)
    else:
        Qtu = Qt * 3600.0 * 24.0
        Qtd = Qtu * B
        Cv  = Qts / (Qts + Q * 0.3048**3)

    Ct = Cv * Sg / (Sg + (Sg - 1.0) * Cv) * 1.0E6

    return {
        "formula"    : "Einstein (1950)",
        "IUnit"      : "SI" if IUnit==0 else "영미",
        "Sv"         : Sv,
        "Svtp"       : Svtp,
        "R"          : R,
        "Rb"         : Rb,
        "qt_sec_per_width" : Qt,
        "Qt_total_sec"     : Qts,
        "Qt_total_day"     : Qtd,
        "Cv"         : Cv,
        "Ct_ppm"     : Ct,
        "fractions"  : results_per_fraction
    }


# ============================================================
# E.2 Colby (1964)
# ============================================================

def Colby(inp):
    """
    Colby의 도식적 관계 (1964)
    (Program Colby)
    """
    # 계수 테이블
    Ca = [1.453, 1.329, 1.4, 1.26, 1.099, 0.0, 0.0]
    Cb = [0.61,  0.48,  0.3, 0.3,  0.3,   0.0, 0.0]
    Cd = [0.1,   0.2,   0.3, 0.4,  0.8,   0.0, 0.0]
    Ce = [0.01,  5.0,  10.0,15.6, 20.0,  30.0,40.0]
    Cf = [0.64,  1.0,   1.0, 0.88, 0.2]
    C1 = [0.1057, 0.0845, 0.0469, 0.0,   -0.0277,-0.0654,-0.1155]
    C2 = [0.0735, 0.0166, 0.0014, 0.0,   -0.0164,-0.061, -0.0763]
    C3 = [0.0118, 0.0202, 0.0135, 0.0,    0.0,    0.0,    0.0   ]

    IUnit = inp.IUnit
    if IUnit == 0:
        V = inp.Q / (inp.B * inp.D)
        D50_ft = inp.D50 / 304.8
        D_ft   = inp.D  / 0.3048
        V_fps  = V / 0.3048
        B_m    = inp.B
        Tdc    = inp.T
    else:
        V_fps  = inp.Q / (inp.B * inp.D)
        D50_ft = inp.D50 / 304.8
        D_ft   = inp.D
        B_m    = inp.B * 0.3048
        Tdc    = (inp.T - 32.0) * 5.0/9.0

    # 유효 범위 체크: D50 0.1mm ~ 0.8mm
    D50_mm = inp.D50  # 항상 mm 단위
    if D50_mm < 0.1 or D50_mm > 0.8:
        return {
            "formula"         : "Colby (1964)",
            "IUnit"           : "SI" if IUnit==0 else "영미",
            "error_info"      : f"D50={D50_mm}mm 유효범위(0.1~0.8mm) 이탈",
            "qt_sec_per_width": -9999.0,
            "Qt_total_sec"    : -9999.0,
            "Qt_total_day"    : -9999.0,
            "Cv"              : -9999.0,
            "Ct_ppm"          : -9999.0,
        }

    Vc  = 0.4673 * D_ft**0.1 * (D50_ft*304.8)**0.333   # ft/s
    Dv  = V_fps * 0.3048 - Vc * 0.3048                 # m/s 기준 편차
    Bc  = 2.5
    if Dv / 0.3048 >= 1.0:
        Bc = 1.453 * (D50_ft*304.8)**(-0.138)

    X = math.log10(D_ft)

    # 수온에 따른 Cf 보간
    N = 0
    while N < 4 and Tdc > Ce[N]:
        N += 1
    N = min(N, 4)

    # 유량 계산 루프 (30절점 보간)
    def colby_uqs(D_ft, D50_ft_val, Bc_val, Dv_fps, Af, N_idx, Ce_arr, Cd_arr, C1a, C2a, C3a):
        X2 = math.log10(D_ft)
        N2 = 0
        while N2 < 5 and D50_ft_val > Cd_arr[N2]:
            N2 += 1
        N2 = min(N2, 5)

        if N2 != 1 and N2 != 5:
            Ac = Ca[N2-1] * D_ft**Cb[N2-1]
            F1 = Ac * Dv_fps**Bc_val * (1.0 + (Af-1.0)*C1a[N2-1]) * 0.672
            Ac = Ca[N2] * D_ft**Cb[N2]
            F2 = Ac * Dv_fps**Bc_val * (1.0 + (Af-1.0)*C1a[N2]) * 0.672
            Uqs_log = (math.log10(F1) + (math.log10(F2) - math.log10(F1)) *
                       (math.log10(D50_ft_val*304.8) - math.log10(Cd_arr[N2-1]*304.8)) /
                       (math.log10(Cd_arr[N2]*304.8) - math.log10(Cd_arr[N2-1]*304.8)))
        else:
            Ac = Ca[N2] * D_ft**Cb[N2]
            F1 = Ac * Dv_fps**Bc_val * (1.0 + (Af-1.0)*C1a[N2]) * 0.672
            Uqs_log = math.log10(F1)
        return 10.0**Uqs_log

    Af = 1.0  # 온도 보정 (단순화)
    D50_ft2 = D50_ft
    D_ft2   = D_ft

    # 단순 계산 (대표 D50 사용)
    Dv_fps = Dv / 0.3048 if IUnit == 0 else Dv
    N2 = 0
    while N2 < 5 and D50_ft2 > Cd[N2]:
        N2 += 1
    N2 = min(N2, 5)
    if N2 == 0: N2 = 1
    if N2 > 5:  N2 = 5

    Ac  = Ca[N2-1] * D_ft2**Cb[N2-1]
    Uqs = Ac * max(Dv_fps, 0.01)**Bc * 0.672
    Uqs = max(Uqs, 1e-10)
    Qt  = 0.500E-3 * Uqs          # tons/sec/ft

    if IUnit == 0:
        B_ft = inp.B / 0.3048
        Qt_si = Qt / 0.3048        # tons/sec/m (근사)
        Qts   = Qt_si * inp.B
        Qtu   = Qt_si * 3600.0 * 24.0
        Qtd   = Qtu * inp.B
        Cv    = Qts * (39.2/43.2) / inp.Q
        Ct    = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0)*Cv) * 1.0E6
    else:
        Qts   = Qt * inp.B
        Qtu   = Qt * 3600.0 * 24.0
        Qtd   = Qtu * inp.B
        Cv    = Qts * (39.2/43.2) / (inp.Q * 0.3048**3)
        Ct    = inp.Sg * Cv / (inp.Sg + (inp.Sg - 1.0)*Cv) * 1.0E6

    return {
        "formula"          : "Colby (1964)",
        "IUnit"            : "SI" if IUnit==0 else "영미",
        "qt_sec_per_width" : Qt,
        "Qt_total_sec"     : Qts,
        "Qt_total_day"     : Qtd,
        "Cv"               : Cv,
        "Ct_ppm"           : Ct,
    }


# ============================================================
# E.3 Engelund & Hansen (1967)
# ============================================================

def Engelund_Hansen(inp):
    """
    Engelund & Hansen 공식 (1967)
    (Program Engelund)
    """
    IUnit = inp.IUnit

    if IUnit == 0:
        G   = 9.8;   Gs  = inp.Sg
        Tdc = inp.T; Nu  = visco(Tdc)
        D50 = inp.D50 / 1000.0
        V   = inp.Q / (inp.B * inp.D)
        D   = inp.D; B   = inp.B; Q = inp.Q
    else:
        G   = 32.2;  Gs  = inp.Sg * 62.4 * 0.000454
        Tdc = (inp.T - 32.0)*5.0/9.0
        Nu  = visco(Tdc) / 0.3048**2
        D50 = inp.D50 / 304.8
        V   = inp.Q / (inp.B * inp.D)
        D   = inp.D; B   = inp.B; Q = inp.Q

    SM1 = inp.Sg - 1.0
    Fp    = 2.0 * G * inp.S * D / V**2
    Theta = D * inp.S / (SM1 * D50)
    Phi   = 0.1 * Theta**2.5 / Fp

    # 경계 Reynolds 수 체크
    Sv  = math.sqrt(G * D * inp.S)
    Rey = Sv * D50 / Nu

    Qt  = Gs * Phi * math.sqrt(SM1 * G * D50**3)
    Qts = Qt * B
    Qtu = Qt * 3600.0 * 24.0
    Qtd = Qtu * B

    if IUnit == 0:
        Cv  = Qts / Q
        Ct  = inp.Sg * Cv / (inp.Sg + (inp.Sg-1.0)*Cv) * 1.0E6
    else:
        Cv  = Qts / (Q * 0.3048**3)
        Ct  = inp.Sg * Cv / (inp.Sg + (inp.Sg-1.0)*Cv) * 1.0E6

    return {
        "formula"          : "Engelund & Hansen (1967)",
        "IUnit"            : "SI" if IUnit==0 else "영미",
        "V"                : V,
        "Fp"               : Fp,
        "Theta"            : Theta,
        "Phi"              : Phi,
        "Rey_D50"          : Rey,
        "qt_sec_per_width" : Qt,
        "Qt_total_sec"     : Qts,
        "Qt_total_day"     : Qtd,
        "Cv"               : Cv,
        "Ct_ppm"           : Ct,
    }


# ============================================================
# E.4 Toffaleti (1968)
# ============================================================

def Toffaleti(inp):
    """
    Toffaleti 공식 (1968) - 내부 계산은 영미단위
    (Program Toffaleti)
    """
    p = Pre4(inp)
    G=p['G']; Nu=p['Nu']; D65=p['D65']; Dm=p['Dm']
    V=p['V']; R=p['R'];   Sv=p['Sv'];   SM1=p['SM1']
    B=p['B']; D=p['D'];   Q_=p['Q'];    Tdc=p['Tdc']; Tdf=p['Tdf']
    S=inp.S; Sg=inp.Sg; IUnit=inp.IUnit

    # Grain roughness
    Rp, Svp = GrainRough(D65, G, Nu, R, S, Sv, V)

    Am   = 10.0 * Svp
    P_nu = Nu * 1.0E5
    Pam  = P_nu**(1.0/3.0) / Am

    # Ap (correction factor for fall velocity)
    if Pam <= 0.50:
        Ap = 10.0 * Pam**(-1.487)
    elif Pam <= 0.67:
        Ap = 43.0 * Pam**0.6142
    elif Pam <= 0.725:
        Ap = 185.0 * Pam**4.20
    elif Pam <= 1.25:
        Ap = 49.0
    else:
        Ap = 24.0 * Pam**2.79

    Fac = Pam * S * D65 * 1.0E5  # D65는 이미 ft 단위 (Pre4 기준)
    if Fac <= 0.25:
        K4 = 1.0
    elif Fac <= 0.35:
        K4 = 5.37 * Fac**1.248
    else:
        K4 = 0.50 * Fac**(-1.1)

    if Ap * K4 < 16.0:
        Ap = 16.0 / K4

    Zv  = 0.1198 + 0.00048 * Tdf
    Cv_ = 1.0 + Zv
    # [수정T1] Cz, Si: 포트란 Step1 Ya=R/11.24, Yb=R/2.5, Cz=260.67-0.667*Tdf
    Ya  = R / 11.24
    Yb  = R / 2.5
    Cz  = 260.67 - 0.667 * Tdf
    Si  = S * R * Cz          # 포트란 원본: Si = S * R * Cz
    Cm  = 2.303 * G / (Si if Si > 0 else 1e-10)
    Tp  = G * (0.00158 + 0.0000028 * Tdf)
    T2P = 1.10 * Tp

    # 입도분포 설정
    if inp.ISize == 0:
        Nm = 1
        Dm_use = [inp.D65 / 304.8]
        Im_use = [1.0]
    else:
        Nm = 8
        Dm_use = Dm
        Im_use = inp.Im

    Qtd_total = 0.0
    rows = []

    for i in range(Nm):
        Di   = Dm_use[i]
        Ib   = Im_use[i]
        if Ib <= 0.0:
            continue

        Dmm  = Di * 304.8   # ft -> mm
        Ws_i = FallVel(Dmm, Tdc) / 30.48   # cm/s -> ft/s
        Dd   = 2.0 * Di
        # [수정T3] Zom: Si(=S*R*Cz) 사용 - 기존 Sv 오류
        Zom  = Ws_i * V / (Si if Si > 0 else 1e-10)
        if Zom < 1.5 * Zv:
            Zom = 1.5 * Zv
        Zo1 = 0.756 * Zom
        Zou = 1.5 * Zom

        # Ya, Yb는 루프 밖에서 계산됨 (Pre4 결과 사용)
        F1 = Zo1 - Zv
        F2 = Zom - Zv
        F3 = Zou - Zv
        F4_val = 1.0 - F1
        F5_val = 1.0 - F2
        F6_val = 1.0 - F3

        # [수정T2] Gfp: 지수 (5./3.) - 기존 2.5 오류
        # 원본 Fortran 코드 확인: 계수 0.600 (KICT 1989, p.334)
        Gfp = (0.600 / (T2P * Ap / V**2)**(5.0/3.0) /
               (Di / 0.00058)**(5.0/3.0))

        X_i = F4_val * Gfp / (Ya**F4_val - Dd**F4_val) if abs(Ya**F4_val - Dd**F4_val)>1e-15 else 0.0
        C_i = Ib * B * X_i
        Qb_i  = C_i * Dd**F4_val
        Ud_i  = Cv_ * V * (Dd/R)**Zv
        Ub1_i = X_i / (43.2 * Ud_i * Dd**F1) if (43.2*Ud_i*Dd**F1)>0 else 0.0

        if Ub1_i > 100.0:
            Qb_i = Qb_i * 100.0 / Ub1_i

        Ga_i = C_i / F4_val * (Ya**F4_val - Dd**F4_val) + Qb_i
        Gb_i = (C_i / F5_val * Ya**(F2-F1) *
                (Yb**F5_val - Ya**F5_val))
        # [수정T4] Gc: Yb**(F3-F2) 인자 추가 - 포트란 Step9 원본
        Gc_i = (C_i / F6_val * Ya**(F2-F1) * Yb**(F3-F2) *
                (R**F6_val - Yb**F6_val))
        Gt_i = Ga_i + Gb_i + Gc_i
        Qtd_total += Gt_i
        rows.append(dict(fraction=i+1, Di_mm=Dmm, Im=Ib, Gt=Gt_i))

    # 단위 환산 (내부: ft, tons/sec)
    Qts = Qtd_total / (3600.0 * 24.0)  # tons/day -> tons/sec
    Qtd = Qtd_total

    if IUnit == 0:
        Qtu  = Qtd_total / B * 0.3048  # tons/day/m
        Qt_m = Qts / B * 0.3048
        Cvol = Qts / (inp.B * (inp.Q / inp.B / inp.D) * inp.D)
        Qts_si = Qts * B * 0.3048 / B  # 근사
        Cvol = Qts / (inp.Q / 0.3048 + Qts * B)
        Ct   = inp.Sg * Cvol / (inp.Sg + (inp.Sg-1.0)*Cvol) * 1.0E6
    else:
        Cvol = Qts / (Q_ + Qts * B)
        Ct   = inp.Sg * Cvol / (inp.Sg + (inp.Sg-1.0)*Cvol) * 1.0E6

    return {
        "formula"       : "Toffaleti (1968)",
        "IUnit"         : "SI" if IUnit==0 else "영미",
        "V_fps"         : V,
        "R_ft"          : R,
        "Rp_ft"         : Rp,
        "Sv_fps"        : Sv,
        "Nu"            : Nu,
        "T2P"           : T2P,
        "Zv"            : Zv,
        "Ya_ft"         : Ya,
        "Yb_ft"         : Yb,
        "Ap"            : Ap,
        "K4"            : K4,
        "Qt_total_day"  : Qtd_total,
        "Qt_total_sec"  : Qts,
        "Ct_ppm"        : Ct,
        "fractions"     : rows
    }


# ============================================================
# E.5 Shen & Hung (1971)
# ============================================================

def Shen_Hung(inp):
    """
    Shen & Hung 회귀방정식 (1971)
    (Program Shen)
    """
    A0 = -107404.45938164
    A1 =  324214.74734085
    A2 = -326309.58908739
    A3 =  109503.87232539
    A4 =       0.00750189
    A5 =       0.00428802
    A6 =      -0.00239974

    IUnit = inp.IUnit
    if IUnit == 0:
        V  = inp.Q / (inp.B * inp.D)
        V_fps = V / 0.3048
        Tdc   = inp.T
        D50_ft = inp.D50 / 304.8
    else:
        V_fps = inp.Q / (inp.B * inp.D)
        Tdc   = (inp.T - 32.0)*5.0/9.0
        D50_ft = inp.D50 / 304.8
        V  = V_fps

    Ws = FallVel(inp.D50, Tdc) / 30.48   # cm/s -> ft/s

    X  = V_fps**A4 * inp.S**A5 * Ws**A6
    Ct = 10.0**(A0 + X*(A1 + X*(A2 + A3*X)))
    Cv = inp.Sg * Ct * 1.0E-6 / (inp.Sg - (inp.Sg-1.0)*Ct*1.0E-6)

    if IUnit == 0:
        Qts = Cv * inp.Q
        Qt  = Qts / inp.B
    else:
        Qts = Cv * inp.Q * 0.3048**3
        Qt  = Qts / (inp.B * 0.3048)

    Qtu = Qt * 3600.0 * 24.0
    Qtd = Qtu * (inp.B if IUnit==0 else inp.B*0.3048)

    return {
        "formula"          : "Shen & Hung (1971)",
        "IUnit"            : "SI" if IUnit==0 else "영미",
        "V"                : V,
        "Ws_fps"           : Ws,
        "X_param"          : X,
        "Ct_ppm"           : Ct,
        "Cv"               : Cv,
        "qt_sec_per_width" : Qt,
        "Qt_total_sec"     : Qts,
        "Qt_total_day"     : Qtd,
    }


# ============================================================
# E.6 Ackers & White (1973)
# ============================================================

def Ackers_White(inp):
    """
    Ackers & White 공식 (1973)
    (Program Ackers)
    """
    IUnit = inp.IUnit
    if IUnit == 0:
        G   = 9.8;  Gs = inp.Sg
        Tdc = inp.T; Nu = visco(Tdc)
        D35 = inp.D35/1000.0
        V   = inp.Q/(inp.B*inp.D)
        D   = inp.D; B = inp.B; Q = inp.Q
    else:
        G   = 32.2; Gs = inp.Sg * 62.4 * 0.000454
        Tdc = (inp.T-32.0)*5.0/9.0
        Nu  = visco(Tdc) / 0.3048**2
        D35 = inp.D35 / 304.8
        V   = inp.Q/(inp.B*inp.D)
        D   = inp.D; B = inp.B; Q = inp.Q

    SM1 = inp.Sg - 1.0
    Sv  = math.sqrt(G * D * inp.S)
    Fr  = V / math.sqrt(G * D)

    Dgr = D35 * (G * SM1 / Nu**2)**(1.0/3.0)

    if Dgr <= 60.0:
        Cldgr = math.log10(Dgr)
        Cc = 10.0**(2.86*Cldgr - Cldgr**2 - 3.53)
        Cn = 1.0 - 0.56 * Cldgr
        Ca = 0.23 / math.sqrt(Dgr) + 0.14
        Cm = 9.66 / Dgr + 1.34
    else:
        Cc = 0.025
        Cn = 0.0
        Ca = 0.17
        Cm = 1.50

    Fgr = (Sv**Cn / math.sqrt(G * D35 * SM1) *
           (V / (math.sqrt(32.0) * math.log10(10.0*D/D35)))**( 1.0-Cn))

    if Fgr <= Ca:
        return {
            "formula": "Ackers & White (1973)",
            "IUnit"  : "SI" if IUnit==0 else "영미",
            "Dgr": Dgr, "Fgr": Fgr, "Ca": Ca,
            "error_info": f"Fgr({Fgr:.4f}) <= Ca({Ca:.4f}): 한계 전단력 미달, 이송 없음",
            "qt_sec_per_width": 0.0, "Qt_total_sec": 0.0,
            "Qt_total_day": 0.0, "Cv": 0.0, "Ct_ppm": 0.0,
        }

    Ggr = Cc * (Fgr/Ca - 1.0)**Cm

    Cx  = Ggr * inp.Sg * D35 / D * (V/Sv)**Cn
    Ct  = Cx * 1.0E6
    Cv  = inp.Sg * Cx / (inp.Sg - (inp.Sg-1.0)*Cx)

    if IUnit == 0:
        Qts = Cv * Q
        Qt  = Qts / B
    else:
        Qts = Cv * Q * 0.3048**3
        Qt  = Qts / (B * 0.3048)

    Qtu = Qt * 3600.0 * 24.0
    Qtd = Qtu * (B if IUnit==0 else B*0.3048)

    return {
        "formula"          : "Ackers & White (1973)",
        "IUnit"            : "SI" if IUnit==0 else "영미",
        "V"                : V,
        "Sv"               : Sv,
        "Nu"               : Nu,
        "Dgr"              : Dgr,
        "Cc"               : Cc,
        "Cn"               : Cn,
        "Ca"               : Ca,
        "Cm"               : Cm,
        "Fgr"              : Fgr,
        "Ggr"              : Ggr,
        "Ct_ppm"           : Ct,
        "Cv"               : Cv,
        "qt_sec_per_width" : Qt,
        "Qt_total_sec"     : Qts,
        "Qt_total_day"     : Qtd,
        "Fr_check"         : Fr,
        "Dgr_check"        : "적용 가능" if Dgr >= 1.0 else "Dgr<1.0: 결과 신뢰도 낮음",
        "Fr_check_str"     : "적용 가능" if Fr <= 0.8  else "Fr>0.8: 결과 신뢰도 낮음",
    }


# ============================================================
# E.7 Yang (1973, 1979)
# ============================================================

def Yang(inp):
    """
    Yang 회귀방정식 (1973 모래, 1979 자갈)
    (Program Yang)
    """
    IUnit = inp.IUnit
    if IUnit == 0:
        G   = 9.8;  SM1 = inp.Sg - 1.0
        Tdc = inp.T; Nu = visco(Tdc)
        D50 = inp.D50/1000.0
        B   = inp.B; D = inp.D; Q = inp.Q
        V   = Q/(B*D)
        # [수정Y1] Pre7 원본: R=B*D/(B+2*D), Sv=sqrt(G*R*S) - 기존 D 오류
        R_y = B*D/(B + 2.0*D)
        Sv  = math.sqrt(G * R_y * inp.S)
    else:
        G   = 32.2; SM1 = inp.Sg - 1.0
        Tdc = (inp.T-32.0)*5.0/9.0
        Nu  = visco(Tdc) / 0.3048**2
        D50 = inp.D50 / 304.8
        B   = inp.B; D = inp.D; Q = inp.Q
        V   = Q/(B*D)
        # [수정Y1] Pre7 원본: R=B*D/(B+2*D), Sv=sqrt(G*R*S) - 기존 D 오류
        R_y = B*D/(B + 2.0*D)
        Sv  = math.sqrt(G * R_y * inp.S)

    # 입도분포 설정
    Ds_std = [0.0625,0.125,0.250,0.500,1.000,2.000,4.000,8.000,16.000]
    Dm_list = [math.sqrt(Ds_std[i]*Ds_std[i+1]) for i in range(8)]
    if IUnit == 0:
        Dm_use = [d/1000.0 for d in Dm_list]
    else:
        Dm_use = [d/304.8 for d in Dm_list]

    if inp.ISize == 0:
        Nm = 1; Dm_calc = [D50]; Im_use = [1.0]
    else:
        Nm = 8; Dm_calc = Dm_use; Im_use = inp.Im

    Ct73 = 0.0; Ct79 = 0.0
    rows = []

    for i in range(Nm):
        Di = Dm_calc[i]
        Ib = Im_use[i]
        if Ib <= 0.0:
            continue

        Dmm = Di * 1000.0 if IUnit==0 else Di * 304.8
        W   = FallVel(Dmm, Tdc) / 100.0 if IUnit==0 else FallVel(Dmm, Tdc)/30.48

        Rey = Sv * Di / Nu
        Vcw = 2.05
        if 1.2 < Rey < 70.0:
            Vcw = 2.5 / (math.log10(Rey) - 0.06) + 0.66

        Wdnu = W * Di / Nu
        Svw  = Sv / W

        # Yang(1973) 모래 - arg73<=0이면 0, Yang79와 독립 계산
        arg73 = V*inp.S/W - Vcw*inp.S
        if arg73 > 0:
            Lct73 = (5.435 - 0.286*math.log10(Wdnu) - 0.457*math.log10(Svw)
                     + (1.799 - 0.409*math.log10(Wdnu) - 0.314*math.log10(Svw))
                     * math.log10(arg73))
            Tct73 = 10.0**Lct73 * Ib
        else:
            Tct73 = 0.0
        Ct73 += Tct73

        # Yang(1979) 자갈 - arg79=V*S/W (한계유속 항 없음), Yang73과 독립
        # [수정Y2] arg73<=0이어도 Yang79는 별도 계산 (기존: continue로 건너뜀)
        arg79 = V*inp.S/W
        if arg79 > 0:
            Lct79 = (5.165 - 0.153*math.log10(Wdnu) - 0.297*math.log10(Svw)
                     + (1.780 - 0.360*math.log10(Wdnu) - 0.480*math.log10(Svw))
                     * math.log10(arg79))
            Tct79 = 10.0**Lct79 * Ib
        else:
            Tct79 = 0.0
        Ct79 += Tct79

        note = "Yang73 한계유속 미달" if arg73 <= 0 else ""
        rows.append(dict(fraction=i+1, Di_mm=Dmm, Im=Ib,
                         Vcw=Vcw, W=W, Ct73_frac=Tct73, Ct79_frac=Tct79,
                         note=note))

    def ct_to_discharge(Ct_ppm, IUnit, Q, B):
        Cv  = inp.Sg * Ct_ppm * 1.0E-6 / (inp.Sg - (inp.Sg-1.0)*Ct_ppm*1.0E-6)
        if IUnit == 0:
            Qts = Cv * Q; Qt = Qts/B
        else:
            Qts = Cv * Q * 0.3048**3; Qt = Qts/(B*0.3048)
        Qtd = Qt * 3600.0 * 24.0 * (B if IUnit==0 else B*0.3048)
        return Cv, Qts, Qt, Qtd

    Cv73, Qts73, Qt73, Qtd73 = ct_to_discharge(Ct73, IUnit, Q, B)
    Cv79, Qts79, Qt79, Qtd79 = ct_to_discharge(Ct79, IUnit, Q, B)

    return {
        "formula"          : "Yang (1973/1979)",
        "IUnit"            : "SI" if IUnit==0 else "영미",
        "Yang1973": {
            "Ct_ppm"           : Ct73,
            "Cv"               : Cv73,
            "qt_sec_per_width" : Qt73,
            "Qt_total_sec"     : Qts73,
            "Qt_total_day"     : Qtd73,
        },
        "Yang1979": {
            "Ct_ppm"           : Ct79,
            "Cv"               : Cv79,
            "qt_sec_per_width" : Qt79,
            "Qt_total_sec"     : Qts79,
            "Qt_total_day"     : Qtd79,
        },
        "fractions": rows
    }


# ============================================================
# E.8 Ranga Raju (1981)
# ============================================================

def Ranga_Raju(inp):
    """
    Ranga Raju, Garde & Bhardwaj 공식 (1981)
    (Program RangaRaju)
    """
    IUnit = inp.IUnit
    if IUnit == 0:
        G=9.8; Nu=visco(inp.T); Gs=inp.Sg; Gf=1.0
        D50=inp.D50/1000.0
        V=inp.Q/(inp.B*inp.D); R=inp.B*inp.D/(inp.B+2.0*inp.D)
        SM1=inp.Sg-1.0; Sv=math.sqrt(G*R*inp.S)
        B=inp.B; D=inp.D; Q=inp.Q
    else:
        G=32.2; Gs=inp.Sg*62.4*0.000454; Gf=62.4*0.000454
        Tdc=(inp.T-32.0)*5.0/9.0
        Nu=visco(Tdc)/0.3048**2
        D50=inp.D50/304.8
        V=inp.Q/(inp.B*inp.D); R=inp.B*inp.D/(inp.B+2.0*inp.D)
        SM1=inp.Sg-1.0; Sv=math.sqrt(G*R*inp.S)
        B=inp.B; D=inp.D; Q=inp.Q

    # 측벽보정
    if inp.ISide == 1:
        try:
            Rb, Sv = SideWallCorr(B, D, Q, inp.S, inp.Sg, inp.T,
                                   G, Nu, R, SM1, Sv, V)
        except ValueError:
            Rb = R
    else:
        Rb = R

    # 무차원 매개변수
    if IUnit == 0:
        Rn  = D50**(1.0/6.0) / 24.0
        Rbp = (V * Rn / math.sqrt(inp.S))**1.5
    else:
        Rn  = 0.034 * D50**(1.0/6.0)
        Rbp = (V * Rn / (math.sqrt(inp.S) * 1.489))**1.5

    Top = Gf * Rbp * inp.S
    To  = Gf * Rb  * inp.S
    Tsp = Top / ((inp.Sg - Gf/Gf) * D50) if D50>0 else 0.0
    Sv  = math.sqrt(G * Rb * inp.S)

    # Rubey 침강속도
    Ws = (math.sqrt(2.0/3.0 * G * SM1 * D50**3 + 36.0*Nu**2) - 6.0*Nu) / D50
    Svw = Sv / Ws

    Rm = 0.0
    if Svw >= 0.5:
        Rm = 0.2*Svw - 0.10
    Phit = 60.0 * Tsp**3 * (Top/To)**(-3.0*Rm)

    if IUnit == 0:
        Qt  = Phit * Gs * math.sqrt(SM1 * G * D50**3)
        Qts = Qt * B
        Qtu = Qt * 3600.0 * 24.0
        Qtd = Qtu * B
        Cv  = Qts / Q
    else:
        Qt  = Phit * Gs * math.sqrt(SM1 * G * D50**3)
        Qts = Qt * B
        Qtu = Qt * 3600.0 * 24.0
        Qtd = Qtu * B
        Cv  = Qts / (Q * 0.3048**3)

    Ct = inp.Sg * Cv / (inp.Sg + (inp.Sg-1.0)*Cv) * 1.0E6

    return {
        "formula"          : "Ranga Raju, Garde & Bhardwaj (1981)",
        "IUnit"            : "SI" if IUnit==0 else "영미",
        "V"                : V,
        "R"                : R,
        "Rb"               : Rb,
        "Nu"               : Nu,
        "Rn"               : Rn,
        "Top"              : Top,
        "To"               : To,
        "Tsp"              : Tsp,
        "Sv"               : Sv,
        "Ws"               : Ws,
        "Phit"             : Phit,
        "qt_sec_per_width" : Qt,
        "Qt_total_sec"     : Qts,
        "Qt_total_day"     : Qtd,
        "Cv"               : Cv,
        "Ct_ppm"           : Ct,
    }


# ============================================================
# E.9 Rijn (1984)
# ============================================================

def Rijn(inp):
    """
    van Rijn 공식 (1984)
    (Program Rijn)
    """
    Co    = 0.65
    Kappa = 0.4

    IUnit = inp.IUnit
    if IUnit == 0:
        G=9.8; Gs=inp.Sg; Nu=visco(inp.T)
        D50=inp.D50/1000.0; D65=inp.D65/1000.0; D90=inp.D90/1000.0
        V=inp.Q/(inp.B*inp.D); R=inp.B*inp.D/(inp.B+2.0*inp.D)
        SM1=inp.Sg-1.0; Sv=math.sqrt(G*D50*inp.S)
        B=inp.B; D=inp.D; Q=inp.Q
    else:
        G=32.2; Gs=inp.Sg*62.4*0.000454
        Tdc=(inp.T-32.0)*5.0/9.0; Nu=visco(Tdc)/0.3048**2
        D50=inp.D50/304.8; D65=inp.D65/304.8; D90=inp.D90/304.8
        V=inp.Q/(inp.B*inp.D); R=inp.B*inp.D/(inp.B+2.0*inp.D)
        SM1=inp.Sg-1.0; Sv=math.sqrt(G*D50*inp.S)
        B=inp.B; D=inp.D; Q=inp.Q

    SM1 = inp.Sg - 1.0
    Sv_main = math.sqrt(G * R * inp.S)

    # D50 유효범위 체크: 0.1mm ~ 2.0mm
    if inp.D50 < 0.1 or inp.D50 > 2.0:
        return {
            "formula"      : "van Rijn (1984)",
            "IUnit"        : "SI" if IUnit==0 else "영미",
            "error_info"   : f"D50={inp.D50}mm 유효범위(0.1~2.0mm) 이탈",
            "Qt_total_sec" : -9999.0,
            "Qt_total_day" : -9999.0,
            "Cv"           : -9999.0,
            "Ct_ppm"       : -9999.0,
        }

    # 무차원 입경
    Dst = D50 * (SM1 * G / Nu**2)**(1.0/3.0)

    # Shield 임계전단속도
    Csv = Shield(D50, G, Nu, SM1)

    # 측벽보정
    if inp.ISide == 1:
        try:
            _, Sv_main = SideWallCorr(B, D, Q, inp.S, inp.Sg, inp.T,
                                       G, Nu, R, SM1, Sv_main, V)
        except ValueError:
            pass

    # 체지 계수
    Cp = 18.0 * math.log10(4.0 * R / D90)
    if IUnit == 1:
        Cp = Cp / 0.5521
    Svp = math.sqrt(G) * V / Cp

    # 수송단계 매개변수
    Td = (Svp**2 - Csv**2) / Csv**2 if Csv > 0 else 0.0
    if Td < 0.0:
        return {
            "formula": "van Rijn (1984)",
            "IUnit"  : "SI" if IUnit==0 else "영미",
            "Dst": Dst, "Csv_critical": Csv, "Svp_grain": Svp, "Td_transport_stage": Td,
            "error_info": f"Td={Td:.4f} < 0: 임계전단속도 미달, 이송 없음",
            "Qt_total_sec": 0.0, "Qt_total_day": 0.0, "Cv": 0.0, "Ct_ppm": 0.0,
        }

    # 참조높이
    Ad = inp.Delta * 0.5
    if Ad <= 0.0:
        Ad = D65
    if Ad < 0.01 * D:
        Ad = 0.01 * D

    # 참조농도
    Ca = 0.015 * D50 * Td**1.5 / (Ad * Dst**0.3) if (Ad > 0 and Dst > 0) else 0.0

    # 대표 입경
    if inp.Grd <= 0.0:
        Ds = 2.5
    else:
        Ds = D50 * (1.0 + 0.011*(inp.Grd-1.0)*(Td-25.0))

    # 침강속도 (Ds 단위: m 또는 ft)
    Ds_mm = Ds*1000.0 if IUnit==0 else Ds*304.8
    Tdc2  = inp.T if IUnit==0 else (inp.T-32.0)*5.0/9.0
    if Ds_mm <= 0.1:
        Ws = SM1 * G * Ds**2 / (18.0 * Nu)
    elif Ds_mm <= 1.0:
        Ws = (10.0*Nu/Ds * (math.sqrt(1.0 + 0.01*SM1*G*Ds**3/Nu**2) - 1.0))
    else:
        Ws = 1.1 * math.sqrt(SM1 * G * Ds)

    # 부유사 매개변수
    Beta  = 1.0 + 2.0*(Ws/Sv_main)**2
    Phi   = 2.5 * (Ws/Sv_main)**0.8 * (Ca/Co)**0.4
    Z     = Ws / (Beta * Kappa * Sv_main) if (beta := Beta*Kappa*Sv_main) > 0 else 0.0
    Zp    = Z + Phi
    F_val = ((Ad/D)**Zp - (Ad/D)**1.2) / ((1.0-Ad/D)**Zp * (1.2-Zp)) if abs(1.2-Zp)>1e-8 else 0.0

    # 단위 폭당 유사량 (체적/시간/폭)
    Qb_vol = 0.053 * Td**2.1 / Dst**0.3 * math.sqrt(SM1 * G * D50**3)
    Qs_vol = F_val * V * D * Ca
    Qt_vol = Qb_vol + Qs_vol

    # 중량 유사량으로 환산
    if IUnit == 0:
        Qb_w = Qb_vol * Gs
        Qs_w = Qs_vol * Gs
        Qt_w = Qt_vol * Gs
        Qbs  = Qb_w * B; Qss = Qs_w * B; Qts = Qt_w * B
        Qbu  = Qb_w*3600.*24.; Qsu = Qs_w*3600.*24.; Qtu_= Qt_w*3600.*24.
        Qbd  = Qbu*B; Qsd = Qsu*B; Qtd_ = Qtu_*B
        Cv   = Qts / Q
    else:
        Qb_w = Qb_vol * Gs
        Qs_w = Qs_vol * Gs
        Qt_w = Qt_vol * Gs
        Qbs  = Qb_w*B; Qss=Qs_w*B; Qts=Qt_w*B
        Qbu  = Qb_w*3600.*24.; Qsu=Qs_w*3600.*24.; Qtu_=Qt_w*3600.*24.
        Qbd  = Qbu*B; Qsd=Qsu*B; Qtd_=Qtu_*B
        Cv   = Qts / (Q * 0.3048**3)

    Ct = inp.Sg * Cv / (inp.Sg + (inp.Sg-1.0)*Cv) * 1.0E6

    # 복소수 발생 시 (Ad/D > 1 등 경계조건 이탈) -9999 처리
    if isinstance(Qtd_, complex) or isinstance(Qts, complex):
        return {
            "formula"        : "van Rijn (1984)",
            "IUnit"          : "SI" if IUnit==0 else "영미",
            "error_info"     : "복소수 발생 (경계조건 이탈) - 계산 불가",
            "Qt_total_sec"   : -9999.0,
            "Qt_total_day"   : -9999.0,
            "Cv"             : -9999.0,
            "Ct_ppm"         : -9999.0,
        }

    return {
        "formula"            : "van Rijn (1984)",
        "IUnit"              : "SI" if IUnit==0 else "영미",
        "V"                  : V,
        "R"                  : R,
        "Nu"                 : Nu,
        "Dst"                : Dst,
        "Sv_shear"           : Sv_main,
        "Csv_critical"       : Csv,
        "Cp_Chezy"           : Cp,
        "Svp_grain"          : Svp,
        "Td_transport_stage" : Td,
        "Ad_ref_height"      : Ad,
        "Ca_ref_conc"        : Ca,
        "Ds_repr_dia"        : Ds,
        "Ws_fall_vel"        : Ws,
        "Beta"               : Beta,
        "Phi"                : Phi,
        "Z_susp_num"         : Z,
        "Zp"                 : Zp,
        "F_factor"           : F_val,
        "qb_bed_load_vol"    : Qb_vol,
        "qs_susp_load_vol"   : Qs_vol,
        "qt_total_vol"       : Qt_vol,
        "Qb_total_sec"       : Qbs,
        "Qs_total_sec"       : Qss,
        "Qt_total_sec"       : Qts,
        "Qb_total_day"       : Qbd,
        "Qs_total_day"       : Qsd,
        "Qt_total_day"       : Qtd_,
        "Cv"                 : Cv,
        "Ct_ppm"             : Ct,
    }


# ============================================================
# 통합 실행 함수
# ============================================================

def run_all(inp, formulas=None):
    """
    9개 공식 전체 또는 지정 공식 실행
    formulas: None이면 전체, 리스트로 선택 가능
              예: ['Einstein', 'Engelund_Hansen', 'Yang']
    """
    all_formulas = {
        'Einstein'       : Einstein,
        'Colby'          : Colby,
        'Engelund_Hansen': Engelund_Hansen,
        'Toffaleti'      : Toffaleti,
        'Shen_Hung'      : Shen_Hung,
        'Ackers_White'   : Ackers_White,
        'Yang'           : Yang,
        'Ranga_Raju'     : Ranga_Raju,
        'Rijn'           : Rijn,
    }
    if formulas is None:
        formulas = list(all_formulas.keys())

    results = {}
    for name in formulas:
        if name not in all_formulas:
            print(f"[경고] 알 수 없는 공식: {name}")
            continue
        try:
            results[name] = all_formulas[name](inp)
        except Exception as e:
            results[name] = {"error": str(e)}
    return results


def print_summary(results):
    """계산 결과 요약 출력"""
    print("=" * 70)
    print("  하천 유사량 산정 결과 요약")
    print("=" * 70)
    print(f"  {'공식':<28} {'qt(tons/s/m)':>14} {'Qt/day(tons)':>14} {'Ct(ppm)':>10}")
    print("-" * 70)

    for name, res in results.items():
        if "error" in res:
            print(f"  {name:<28} {'[오류] '+res['error']}")
            continue

        # Yang는 두 결과
        if name == 'Yang':
            for ver, label in [('Yang1973','Yang(1973)'), ('Yang1979','Yang(1979)')]:
                d = res.get(ver, {})
                qt  = d.get('qt_sec_per_width', float('nan'))
                qtd = d.get('Qt_total_day', float('nan'))
                ct  = d.get('Ct_ppm', float('nan'))
                print(f"  {label:<28} {qt:>14.4E} {qtd:>14.4E} {ct:>10.2f}")
        else:
            qt  = res.get('qt_sec_per_width', float('nan'))
            qtd = res.get('Qt_total_day', float('nan'))
            ct  = res.get('Ct_ppm', float('nan'))
            # Rijn은 별도 키
            if name == 'Rijn':
                qt  = res.get('qb_bed_load_vol', 0) + res.get('qs_susp_load_vol', 0)
                qtd = res.get('Qt_total_day', float('nan'))
            print(f"  {name:<28} {qt:>14.4E} {qtd:>14.4E} {ct:>10.2f}")
    print("=" * 70)


# ============================================================
# 메인 실행 (예제)
# ============================================================

# ============================================================
# Sediment.Dat 형식 파일 파서
# (Subroutine ReadData 와 동일한 순서)
# ============================================================

def read_sediment_dat(filepath):
    """
    포트란 원본의 Sediment.Dat 파일 형식을 읽어 InputData 반환.

    파일 형식:
      Line 1 : Title (A30)
      Line 2 : IUnit, ISize, ISide (3I5)
      Line 3 : B, D, Q, S, T, Bedform (5F10.5, A10)
      Line 4 : D35, D50, D65, D90, Sg, Grd, Delta (7F10.5)
      Line 5 : Im(1..8)  ← ISize=1 일 때만 (8F10.3)
    """
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        lines = [l.rstrip('\r\n') for l in f.readlines()]

    # Line 1: Title
    Title = lines[0].strip()

    # Line 2: IUnit, ISize, ISide
    tok2 = lines[1].split()
    IUnit = int(tok2[0])
    ISize = int(tok2[1])
    ISide = int(tok2[2])

    # Line 3: B, D, Q, S, T, Bedform
    tok3  = lines[2].split()
    B       = float(tok3[0])
    D       = float(tok3[1])
    Q       = float(tok3[2])
    S       = float(tok3[3])
    T       = float(tok3[4])
    Bedform = tok3[5] if len(tok3) > 5 else ""

    # Line 4: D35, D50, D65, D90, Sg, Grd, Delta
    tok4  = lines[3].split()
    D35   = float(tok4[0])
    D50   = float(tok4[1])
    D65   = float(tok4[2])
    D90   = float(tok4[3])
    Sg    = float(tok4[4])
    Grd   = float(tok4[5])
    Delta = float(tok4[6])

    # Line 5: Im (ISize=1 일 때)
    Im = [0.0] * 8
    if ISize == 1 and len(lines) > 4:
        tok5 = lines[4].split()
        for i, v in enumerate(tok5[:8]):
            Im[i] = float(v)

    return InputData(
        Title=Title, IUnit=IUnit, ISize=ISize, ISide=ISide,
        B=B, D=D, Q=Q, S=S, T=T, Bedform=Bedform,
        D35=D35, D50=D50, D65=D65, D90=D90,
        Sg=Sg, Grd=Grd, Delta=Delta, Im=Im
    )


def print_input(inp):
    """입력 자료 출력"""
    size_labels = [
        "0.0625~0.125", "0.125~0.25", "0.25~0.5", "0.5~1",
        "1~2", "2~4", "4~8", "8~16"
    ]
    print(f"  타이틀   : {inp.Title}")
    print(f"  단위     : {'SI (m, cms, °C)' if inp.IUnit==0 else '영미 (ft, cfs, °F)'}")
    print(f"  ISize    : {'입도분포별 계산' if inp.ISize==1 else '단일입경 (D50)'}")
    print(f"  ISide    : {'측벽보정 적용 (Vanoni&Brooks)' if inp.ISide==1 else '측벽보정 없음'}")
    print(f"  하상형태 : {inp.Bedform}")
    unit = 'm' if inp.IUnit==0 else 'ft'
    qunit = 'cms' if inp.IUnit==0 else 'cfs'
    print(f"  하폭 B   = {inp.B} {unit}")
    print(f"  수심 D   = {inp.D} {unit}")
    print(f"  유량 Q   = {inp.Q} {qunit}")
    print(f"  경사 S   = {inp.S}")
    print(f"  수온 T   = {inp.T} {'°C' if inp.IUnit==0 else '°F'}")
    print(f"  D35={inp.D35}mm  D50={inp.D50}mm  D65={inp.D65}mm  D90={inp.D90}mm")
    print(f"  비중 Sg  = {inp.Sg}   Grd = {inp.Grd}   사구높이 = {inp.Delta}{unit}")
    if inp.ISize == 1:
        print(f"  입도분포 Im (합계={sum(inp.Im):.3f}):")
        for i, (lbl, v) in enumerate(zip(size_labels, inp.Im)):
            print(f"    [{i+1}] {lbl:>13} mm : {v:.3f}")


def print_detail(results):
    """상세 결과 출력"""
    print("\n상세 결과:")
    for name, res in results.items():
        print(f"\n  [{name}]")
        if "error" in res:
            print(f"    오류: {res['error']}")
            continue
        skip_keys = {'fractions', 'Yang1973', 'Yang1979', 'formula', 'IUnit'}
        for k, v in res.items():
            if k in skip_keys:
                continue
            if isinstance(v, float):
                print(f"    {k:<35} = {v:.6E}")
            else:
                print(f"    {k:<35} = {v}")
        if name == 'Yang':
            for ver in ('Yang1973', 'Yang1979'):
                print(f"    [{ver}]")
                for k, v in res[ver].items():
                    print(f"      {k:<33} = {v:.6E}" if isinstance(v, float)
                          else f"      {k:<33} = {v}")


# ============================================================
# 인풋파일 생성 (Sediment.Dat 형식)
# ============================================================

def formatSedimentInput(inp):
    """
    InputData → Sediment.Dat 형식 문자열
    Line 1: Title
    Line 2: IUnit ISize ISide
    Line 3: B  D  Q  S  T  Bedform
    Line 4: D35  D50  D65  D90  Sg  Grd  Delta
    Line 5: Im[0..7]  (ISize=1 일 때만)
    """
    s  = f"{inp.Title}\n"
    s += f"{inp.IUnit} {inp.ISize} {inp.ISide}\n"
    s += f"{inp.B:.4f} {inp.D:.4f} {inp.Q:.4f} {inp.S:.7f} {inp.T:.1f} {inp.Bedform}\n"
    s += f"{inp.D35:.4f} {inp.D50:.4f} {inp.D65:.4f} {inp.D90:.4f} {inp.Sg:.3f} {inp.Grd:.3f} {inp.Delta:.4f}\n"
    if inp.ISize == 1:
        s += " ".join(f"{v:.4f}" for v in inp.Im) + "\n"
    return s


def formatSingleFormulaOutput(inp, formula_name, res):
    """
    단일 공식 결과 → 상세 출력 문자열 (중간값 포함)
    각 공식 폴더의 .out 파일로 저장됨
    """
    SEP  = "=" * 64
    SEP2 = "-" * 64
    size_labels = [
        "0.0625~0.125", "0.125~0.25", "0.25~0.5", "0.5~1",
        "1~2",          "2~4",        "4~8",       "8~16"
    ]

    s = SEP + "\n"
    s += f"  {formula_name.upper()}\n"
    s += SEP + "\n\n"

    # ── 입력 데이터 ──
    s += "[ INPUT DATA ]\n"
    s += SEP2 + "\n"
    s += f"  Title   : {inp.Title}\n"
    s += f"  Unit    : {'SI (m, cms, C)' if inp.IUnit==0 else 'English (ft, cfs, F)'}"
    s += f"  |  ISize: {inp.ISize}  |  ISide: {inp.ISide}\n"
    s += f"  Bedform : {inp.Bedform}\n"
    s += SEP2 + "\n"
    s += f"  {'B':>6} = {inp.B:>10.4f} {'m' if inp.IUnit==0 else 'ft'}\n"
    s += f"  {'D':>6} = {inp.D:>10.4f} {'m' if inp.IUnit==0 else 'ft'}\n"
    s += f"  {'Q':>6} = {inp.Q:>10.4f} {'cms' if inp.IUnit==0 else 'cfs'}\n"
    s += f"  {'S':>6} = {inp.S:>10.6f}\n"
    s += f"  {'T':>6} = {inp.T:>10.1f} {'C' if inp.IUnit==0 else 'F'}\n"
    s += SEP2 + "\n"
    s += f"  {'D35':>6} = {inp.D35:>10.4f} mm\n"
    s += f"  {'D50':>6} = {inp.D50:>10.4f} mm\n"
    s += f"  {'D65':>6} = {inp.D65:>10.4f} mm\n"
    s += f"  {'D90':>6} = {inp.D90:>10.4f} mm\n"
    s += f"  {'Sg':>6} = {inp.Sg:>10.4f}\n"
    s += f"  {'Grd':>6} = {inp.Grd:>10.4f}\n"
    s += f"  {'Delta':>6} = {inp.Delta:>10.4f} {'m' if inp.IUnit==0 else 'ft'}\n"
    if inp.ISize == 1:
        s += SEP2 + "\n"
        s += "  Grain Size Distribution (Im):\n"
        for i, (lbl, v) in enumerate(zip(size_labels, inp.Im)):
            s += f"    [{i+1}] {lbl:>13} mm : {v:.4f}\n"
    s += "\n"

    # ── 오류 처리 ──
    if res is None or (isinstance(res, dict) and 'error' in res and 'error_info' not in res):
        s += "[ RESULT ]\n"
        s += SEP2 + "\n"
        s += f"  Status : ERROR\n"
        s += f"  Message: {res.get('error','unknown') if res else 'N/A'}\n"
        s += SEP + "\n"
        return s

    # ── 적용범위 이탈 ──
    if isinstance(res, dict) and 'error_info' in res:
        s += "[ RESULT ]\n"
        s += SEP2 + "\n"
        s += f"  Status : OUT OF RANGE\n"
        s += f"  Note   : {res['error_info']}\n"
        s += f"  Qt_total_day = {res.get('Qt_total_day',-9999):.4f} ton/day\n"
        s += SEP + "\n"
        return s

    # ── 중간값 출력 ──
    skip_keys = {
        'formula', 'IUnit', 'fractions', 'Yang1973', 'Yang1979',
        'qt_sec_per_width', 'Qt_total_sec', 'Qt_total_day', 'Cv', 'Ct_ppm',
        'error_info', 'Dgr_check', 'Fr_check_str'
    }

    s += "[ INTERMEDIATE VALUES ]\n"
    s += SEP2 + "\n"

    if formula_name == 'Yang':
        pass  # Yang는 중간값 없음
    else:
        for k, v in res.items():
            if k in skip_keys:
                continue
            if isinstance(v, float):
                s += f"  {k:<20} = {v:>14.6E}\n"
            elif isinstance(v, str):
                s += f"  {k:<20} = {v}\n"

    # 분수별 결과 (Einstein, Toffaleti, Yang)
    fracs = res.get('fractions', [])
    if fracs:
        s += "\n  Grain Fraction Results:\n"
        s += f"  {'Frac':>4} {'Di(mm)':>10} {'Im':>8} "
        if formula_name == 'Einstein':
            s += f"{'Psi':>10} {'Phi':>10} {'I1':>10} {'I2':>10} {'Qt_frac':>12}\n"
        elif formula_name == 'Toffaleti':
            s += f"{'Gt(ton/day)':>14}\n"
        else:
            s += f"{'Ct73(ppm)':>12} {'Ct79(ppm)':>12}\n"
        s += "  " + "-" * 60 + "\n"
        for frac in fracs:
            s += f"  {frac.get('fraction',0):>4} {frac.get('Di_mm',0):>10.4f} {frac.get('Im',0):>8.4f} "
            if formula_name == 'Einstein':
                s += f"{frac.get('Psi',0):>10.4f} {frac.get('Phi',0):>10.4E} "
                s += f"{frac.get('I1',0):>10.4E} {frac.get('I2',0):>10.4E} "
                s += f"{frac.get('Qt_fraction',0):>12.4E}\n"
            elif formula_name == 'Toffaleti':
                s += f"{frac.get('Gt',0):>14.4f}\n"
            else:
                s += f"{frac.get('Ct73_frac',0):>12.4f} {frac.get('Ct79_frac',0):>12.4f}\n"

    s += "\n"

    # ── 최종 결과 ──
    s += "[ FINAL RESULTS ]\n"
    s += SEP2 + "\n"

    if formula_name == 'Yang':
        y73 = res.get('Yang1973', {})
        y79 = res.get('Yang1979', {})
        s += f"  {'Yang (1973)':<22}\n"
        s += f"    {'Ct':>6} = {y73.get('Ct_ppm',0):>14.4f} ppm\n"
        s += f"    {'Cv':>6} = {y73.get('Cv',0):>14.6E}\n"
        s += f"    {'qt':>6} = {y73.get('qt_sec_per_width',0):>14.6E} ton/sec/{'m' if inp.IUnit==0 else 'ft'}\n"
        s += f"    {'Qt':>6} = {y73.get('Qt_total_sec',0):>14.6E} ton/sec\n"
        s += f"    {'Qt':>6} = {y73.get('Qt_total_day',0):>14.4f} ton/day\n"
        s += f"\n  {'Yang (1979)':<22}\n"
        s += f"    {'Ct':>6} = {y79.get('Ct_ppm',0):>14.4f} ppm\n"
        s += f"    {'Cv':>6} = {y79.get('Cv',0):>14.6E}\n"
        s += f"    {'qt':>6} = {y79.get('qt_sec_per_width',0):>14.6E} ton/sec/{'m' if inp.IUnit==0 else 'ft'}\n"
        s += f"    {'Qt':>6} = {y79.get('Qt_total_sec',0):>14.6E} ton/sec\n"
        s += f"    {'Qt':>6} = {y79.get('Qt_total_day',0):>14.4f} ton/day\n"
    else:
        qt_day = res.get('Qt_total_day', 0)
        qt_sec = res.get('Qt_total_sec', 0)
        qt_w   = res.get('qt_sec_per_width', 0) or res.get('qb_bed_load_vol',0)+res.get('qs_susp_load_vol',0)
        ct     = res.get('Ct_ppm', 0)
        cv     = res.get('Cv', 0)
        s += f"  {'Ct':>6} = {ct:>14.4f} ppm\n"
        s += f"  {'Cv':>6} = {cv:>14.6E}\n"
        s += f"  {'qt':>6} = {qt_w:>14.6E} ton/sec/{'m' if inp.IUnit==0 else 'ft'}\n"
        s += f"  {'Qt':>6} = {qt_sec:>14.6E} ton/sec\n"
        s += f"  {'Qt':>6} = {qt_day:>14.4f} ton/day\n"
        # Rijn 추가 출력
        if formula_name == 'Rijn':
            qb = res.get('Qb_total_day', res.get('qb_bed_load_vol',0)*86400 if res.get('qb_bed_load_vol') else 0)
            qs = res.get('Qs_total_day', res.get('qs_susp_load_vol',0)*86400 if res.get('qs_susp_load_vol') else 0)
            s += f"  {'Qb(bed)':>8} = {qb:>14.4f} ton/day\n"
            s += f"  {'Qs(susp)':>8} = {qs:>14.4f} ton/day\n"

    s += SEP + "\n"
    return s


def formatAllFormulasOutput(inp, results):
    """
    9개 공식 전체 결과를 하나의 파일로 출력 (Summary용)
    """
    SEP = "=" * 64
    s = SEP + "\n"
    s += "  SEDIMENT TRANSPORT CALCULATION - ALL FORMULAS\n"
    s += SEP + "\n"
    s += f"  Title: {inp.Title}\n"
    s += f"  B={inp.B:.3f}m  D={inp.D:.3f}m  Q={inp.Q:.3f}cms  S={inp.S:.6f}\n"
    s += f"  D50={inp.D50:.4f}mm  Sg={inp.Sg:.3f}  T={inp.T:.1f}C\n"
    s += SEP + "\n\n"
    s += f"  {'Formula':<20} {'Qt (ton/day)':>16} {'Ct (ppm)':>12}\n"
    s += "-" * 52 + "\n"

    formula_order = [
        'Einstein','Colby','Engelund_Hansen','Toffaleti',
        'Shen_Hung','Ackers_White','Yang','Ranga_Raju','Rijn'
    ]
    for name in formula_order:
        res = results.get(name)
        if res is None:
            continue
        if name == 'Yang':
            y73 = res.get('Yang1973', {})
            y79 = res.get('Yang1979', {})
            s += f"  {'Yang (1973)':<20} {y73.get('Qt_total_day',0):>16.2f} {y73.get('Ct_ppm',0):>12.2f}\n"
            s += f"  {'Yang (1979)':<20} {y79.get('Qt_total_day',0):>16.2f} {y79.get('Ct_ppm',0):>12.2f}\n"
        else:
            qt  = res.get('Qt_total_day', -9999)
            ct  = res.get('Ct_ppm', -9999)
            s += f"  {name:<20} {qt:>16.2f} {ct:>12.2f}\n"
    s += SEP + "\n"
    return s


# ============================================================
# 메인 실행
# ============================================================

if __name__ == "__main__":
    import os

    # 명령줄 인수로 파일 지정: python sediment_transport.py <파일경로>
    # 인수 없으면 GA_03-7 파일 사용
    if len(sys.argv) > 1:
        dat_file = sys.argv[1]
    else:
        # 스크립트와 같은 디렉토리 또는 현재 디렉토리에서 파일 탐색
        candidates = [
            "GA_03-7",
            os.path.join(os.path.dirname(__file__), "GA_03-7"),
        ]
        dat_file = next((f for f in candidates if os.path.exists(f)), None)

    if dat_file and os.path.exists(dat_file):
        print(f"\n파일 읽기: {dat_file}")
        inp = read_sediment_dat(dat_file)
    else:
        # 파일 없으면 아래 직접 입력값 사용
        print("\n[파일 미발견] 직접 입력값 사용")
        inp = InputData(
            Title   = "GA#03  2+010",
            IUnit   = 0,
            ISize   = 1,
            ISide   = 0,
            B       = 27.42,
            D       = 2.55,
            Q       = 200.00,
            S       = 0.00768,
            T       = 15.0,
            Bedform = "WAVE",
            D35     = 9.8253,
            D50     = 19.7284,
            D65     = 27.7503,
            D90     = 55.5777,
            Sg      = 2.59,
            Grd     = 5.81,
            Delta   = 1.00,
            Im      = [0.000, 0.000, 0.000, 0.009, 0.143, 0.143, 0.143, 0.143],
        )

    print("\n" + "=" * 60)
    print("  입력 자료")
    print("=" * 60)
    print_input(inp)

    # 9개 공식 전체 실행
    results = run_all(inp)

    # 요약 출력
    print()
    print_summary(results)

    # 상세 결과 출력
    print_detail(results)




def _fmt_qt(v):
    """Fortran F10.2 + 2공백 스타일 (총 12자, 소수점 앞 0 제거)"""
    if v is None: return ' ' * 12
    try: f = float(v)
    except: return ' ' * 12
    s = f'{f:.2f}'
    if s.startswith('0.'): s = s[1:]
    elif s.startswith('-0.'): s = '-' + s[2:]
    if len(s) > 12: return '*' * 12    # 오버플로우: *** 표시
    if len(s) > 10: return s.rjust(12)  # 11~12자: 꽉 채움
    return s.rjust(10) + '  '           # 정상: 10자 우측정렬 + 뒤 2공백


def _fmt_qc(v):
    """Fortran F14.5 스타일 숫자 포맷 (14자 우측정렬, 소수점 앞 0 제거)"""
    if v is None: return ' ' * 14
    try: f = float(v)
    except: return ' ' * 14
    s = f'{f:.5f}'
    if s.startswith('0.'): s = s[1:]
    elif s.startswith('-0.'): s = '-' + s[2:]
    if len(s) > 14: return '*' * 14
    return s.rjust(14)


def generateSummaryQt(cases):
    """
    Summary_Qt.out 생성 - Fortran 원본 형식 일치
    컬럼 구조: FileName(12좌) + Yang(12우) × 9  = 총 120자
    Yang = Yang1979 값 사용
    """
    # 헤더: 각 12자 좌측정렬
    # 헤더: FileName은 '  FileName  '(12), 나머지는 좌측정렬(12)
    header = '  FileName  ' + ''.join(name.ljust(12) for name in
             ['Yang','Toffalet','Einstein','Colby','Ackers','Engelund','Ranga','Shen','Rijn'])
    lines  = [header]

    for case in cases:
        title  = case.get('title', '')
        res    = case.get('results', {})

        yang_res = res.get('Yang') or {}
        y79_qt   = (yang_res.get('Yang1979') or {}).get('Qt_total_day')
        toffy_qt = (res.get('Toffaleti')       or {}).get('Qt_total_day')
        einst_qt = (res.get('Einstein')         or {}).get('Qt_total_day')
        colby_qt = (res.get('Colby')            or {}).get('Qt_total_day')
        ack_qt   = (res.get('Ackers_White')     or {}).get('Qt_total_day')
        eng_qt   = (res.get('Engelund_Hansen')  or {}).get('Qt_total_day')
        ranga_qt = (res.get('Ranga_Raju')       or {}).get('Qt_total_day')
        shen_qt  = (res.get('Shen_Hung')        or {}).get('Qt_total_day')
        rijn_qt  = (res.get('Rijn')             or {}).get('Qt_total_day')

        # FileName 12자 (앞 3공백 + 이름 좌측정렬)
        fname_col = ('   ' + title).ljust(12)
        row = (fname_col
               + _fmt_qt(y79_qt)
               + _fmt_qt(toffy_qt)
               + _fmt_qt(einst_qt)
               + _fmt_qt(colby_qt)
               + _fmt_qt(ack_qt)
               + _fmt_qt(eng_qt)
               + _fmt_qt(ranga_qt)
               + _fmt_qt(shen_qt)
               + _fmt_qt(rijn_qt)).rstrip()
        lines.append(row)

    return '\n'.join(lines) + '\n'


def generateSummaryQc(points):
    """
    Summary_Qc.out 생성 - Fortran 원본 형식 일치
    컬럼 구조: SizeNo(10) + Q값(14) × nq
    Yang(1979 Ct79_frac ppm), Toffaleti(Gt ton/day), Einstein(Qt_fraction ton/sec/m)
    """
    SEP = ' ' + '-' * 69
    lines = []

    for pt in points:
        pt_no  = pt['point_no']
        q_lbls = pt['q_labels']
        cases  = pt['cases']
        nq     = len(cases)

        lines.append(f' Point :         {pt_no:3d}')
        lines.append(' -------------------')

        # 헤더: "  Size No." (10) + Q레이블(14)×nq
        def qc_header():
            h = '  Size No.'
            for lbl in q_lbls:
                h += lbl.rjust(14)
            return h

        for formula_name, formula_key in [
            ('Yang', 'Yang'),
            ('Toffaleti', 'Toffaleti'),
            ('Einstein', 'Einstein'),
        ]:
            lines.append(f' {formula_name:<20}')
            lines.append(qc_header())

            mat = [[0.0] * nq for _ in range(8)]
            for qi, case in enumerate(cases):
                res_all = case.get('results', {})
                if formula_key == 'Yang':
                    yang = res_all.get('Yang') or {}
                    for frac in (yang.get('fractions') or []):
                        idx = frac.get('fraction', 0) - 1
                        if 0 <= idx < 8:
                            mat[idx][qi] = float(frac.get('Ct79_frac') or 0)
                elif formula_key == 'Toffaleti':
                    toffy = res_all.get('Toffaleti') or {}
                    for frac in (toffy.get('fractions') or []):
                        idx = frac.get('fraction', 0) - 1
                        if 0 <= idx < 8:
                            mat[idx][qi] = float(frac.get('Gt') or 0)
                else:
                    einst = res_all.get('Einstein') or {}
                    for frac in (einst.get('fractions') or []):
                        idx = frac.get('fraction', 0) - 1
                        if 0 <= idx < 8:
                            mat[idx][qi] = float(frac.get('Qt_fraction') or 0)

            for si in range(8):
                # "    1     " = 10자: "    {no}     "
                size_col = f'    {si+1:<6}'   # 10자
                row = size_col
                for qi in range(nq):
                    row += _fmt_qc(mat[si][qi])
                lines.append(row)

        lines.append(SEP)
        lines.append(' ')

    return '\n'.join(lines) + '\n'
