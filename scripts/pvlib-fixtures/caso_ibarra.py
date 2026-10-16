"""
Caso de prueba Ibarra — referencia de la cadena completa con pvlib.

1. Genera un año meteorológico SINTÉTICO y reproducible para Ibarra (0.35, −78.12, 2225 m):
   cielo claro Ineichen (turbidez de Linke de pvlib) × índice de nubosidad aleatorio (AR(1), semilla fija),
   separación DNI/DHI con Erbs. Sirve para validar el motor (no reemplaza a PVGIS ni a mediciones).
2. Simula con pvlib el mismo sistema que la app, con los mismos modelos y supuestos:
   SPA a mitad de hora, Perez 1990, albedo isotrópico, IAM ASHRAE (directa) + Marion (difusa),
   suciedad, Faiman/PVsyst (Uc = 29), CEC/De Soto, pérdidas DC multiplicativas, óhmica ∝ I², Sandia.
Salida: src/engine/__tests__/fixtures/casoIbarra.json y public/data/ibarra-sintetico.json
"""
import json
import os
import numpy as np
import pandas as pd
import pvlib
from pvlib import atmosphere, irradiance, iam, pvsystem, inverter, temperature, solarposition

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SEMILLA = os.path.join(RAIZ, 'src', 'catalogo', 'semilla')
LAT, LON, ALT, HUSO = 0.35, -78.12, 2225.0, -5
ANIO = 2025

# ── Calendario: 8760 h locales, dato = promedio de [hh:00, hh+1:00) → posición a hh:30 ──
idx_local = np.arange(8760)
t_utc = pd.Timestamp(f'{ANIO}-01-01', tz='UTC') + pd.to_timedelta(idx_local * 3600 - HUSO * 3600 + 1800, unit='s')
t_utc = pd.DatetimeIndex(t_utc)
doy = idx_local // 24 + 1
mes = pd.DatetimeIndex(pd.Timestamp(f'{ANIO}-01-01') + pd.to_timedelta(idx_local, unit='h')).month.values - 1

pres = atmosphere.alt2pres(ALT)
sp = solarposition.spa_python(t_utc, LAT, LON, altitude=ALT, pressure=pres, temperature=12, delta_t=69, atmos_refract=0.5667)
zen = sp['apparent_zenith'].values
az_n = sp['azimuth'].values  # 0 = N

# ── 1. Clima sintético ──
rng = np.random.default_rng(2225)
loc = pvlib.location.Location(LAT, LON, altitude=ALT)
cs = loc.get_clearsky(t_utc, model='ineichen', solar_position=sp)
# Nubosidad: estacionalidad andina (ene–may más nublado) + AR(1) horario
estacional = 0.62 + 0.10 * np.cos(2 * np.pi * (doy - 220) / 365)
ruido = np.zeros(8760)
for i in range(1, 8760):
    ruido[i] = 0.85 * ruido[i - 1] + rng.normal(0, 0.12)
kc = np.clip(estacional + ruido, 0.12, 1.05)
ghi = np.where(zen < 90, cs['ghi'].values * kc, 0.0)
ghi = np.round(ghi, 1)
dni_extra = irradiance.get_extra_radiation(doy, method='spencer', solar_constant=1366.1)
e = irradiance.erbs(ghi, zen, doy)
dni = np.round(np.asarray(e['dni']), 1)
dhi = np.round(np.asarray(e['dhi']), 1)
h = idx_local % 24
tamb = np.round(14.5 + 5.5 * np.sin(2 * np.pi * (h - 9) / 24) * (0.6 + 0.4 * kc) + rng.normal(0, 0.6, 8760), 1)
viento = np.round(np.clip(1.8 + 1.2 * np.sin(2 * np.pi * (h - 10) / 24) + rng.normal(0, 0.5, 8760), 0, None), 1)

clima = dict(fuente='sintetico', descripcion='Año sintético reproducible para Ibarra (solo para pruebas del motor)',
             latitud=LAT, longitud=LON, altitud=ALT, husoHorario=HUSO, desfaseSolarHoras=0.5, anioReferencia=ANIO,
             ghi=ghi.tolist(), dni=dni.tolist(), dhi=dhi.tolist(), tamb=tamb.tolist(), viento=viento.tolist())

# ── 2. Sistema de prueba ──
mods = {m['id']: m for m in json.load(open(os.path.join(SEMILLA, 'modulosCEC.json')))}
invs = {m['id']: m for m in json.load(open(os.path.join(SEMILLA, 'inversoresCEC.json')))}
mod = mods['cec-jinko-solar-co-ltd-jkm560n-72hl4-tv']
inv = invs['cec-fronius-international-gmbh-fronius-primo-50-1-208-240-240v']
N_SERIE, N_PAR, N_INV = 10, 1, 1
TILT, AZ_PVSYST = 10.0, 0.0
ALBEDO = 0.2
B0 = 0.05
PERD = dict(suciedad=0.02, calidadModulo=-0.004, lid=0.01, mismatch=0.02, ohmicaDC=0.015, ohmicaAC=0.01, indisponibilidad=0.0)

n_mod = N_SERIE * N_PAR
eta = mod['pNom'] / (1000 * mod['area'])
dni_ef = np.where(np.cos(np.radians(zen)) > 0, dni, 0.0)
cos_aoi = np.clip(irradiance.aoi_projection(TILT, AZ_PVSYST + 180, zen, az_n), -1, 1)
aoi_deg = np.degrees(np.arccos(cos_aoi))
directa = np.maximum(dni_ef * np.where(zen < 90, cos_aoi, 0), 0)
am = atmosphere.get_relative_airmass(zen, model='kastenyoung1989')
dif = irradiance.perez(TILT, AZ_PVSYST + 180, dhi, dni_ef, dni_extra, zen, az_n, am, return_components=True)
dif = {k: np.nan_to_num(np.asarray(v)) for k, v in dif.items()}
suelo = irradiance.get_ground_diffuse(TILT, ghi, albedo=ALBEDO)
poa = directa + dif['poa_sky_diffuse'] + suelo
md = iam.marion_diffuse('ashrae', TILT, b=B0)
g_iam = (directa + dif['poa_circumsolar']) * iam.ashrae(aoi_deg, B0) + \
        (dif['poa_isotropic'] + dif['poa_horizon']) * md['sky'] + suelo * md['ground']
g_ef = g_iam * (1 - PERD['suciedad'])
tc = temperature.pvsyst_cell(poa, tamb, viento, u_c=29, u_v=0, module_efficiency=eta, alpha_absorption=0.9)
c = mod['cec']
IL, I0, Rs, Rsh, nNsVth = pvsystem.calcparams_cec(g_ef, tc, c['alphaSc'], c['aRef'], c['ILref'], c['I0ref'], c['RshRef'], c['Rs'], c['adjust'])
sd = pvsystem.singlediode(IL, I0, Rs, Rsh, nNsVth, method='lambertw')
pmp = np.nan_to_num(np.asarray(sd['p_mp']))
vmp = np.nan_to_num(np.asarray(sd['v_mp']))
pmp = np.where(g_ef > 0, pmp, 0)
p_stc = n_mod * mod['pNom']
pg = pmp * n_mod * (1 - PERD['calidadModulo']) * (1 - PERD['lid']) * (1 - PERD['mismatch'])
pg = np.maximum(pg - PERD['ohmicaDC'] * pg ** 2 / p_stc, 0)
s = inv['sandia']
ps = pd.Series(dict(Paco=s['Paco'], Pdco=s['Pdco'], Vdco=s['Vdco'], Pso=s['Pso'], C0=s['C0'], C1=s['C1'], C2=s['C2'], C3=s['C3'], Pnt=s['Pnt']))
vdc = vmp * N_SERIE
pac = np.asarray(inverter.sandia(np.where(vdc > 0, vdc, s['Vdco']), pg / N_INV, ps)) * N_INV
pac = np.where(pg / N_INV < s['Pso'], 0, pac)
pac = np.maximum(pac - PERD['ohmicaAC'] * pac ** 2 / (s['Paco'] * N_INV), 0) * (1 - PERD['indisponibilidad'])

assert (vdc[pg > 0] >= s['MpptLow']).all() and (vdc[pg > 0] <= s['MpptHigh']).all(), 'el caso debe quedar dentro de la ventana MPPT'


def mensual(x):
    return [float(np.sum(x[mes == m]) / 1000) for m in range(12)]


ref = dict(
    pvlib=pvlib.__version__,
    sistema=dict(modulo=mod['id'], inversor=inv['id'], nSerie=N_SERIE, nParalelo=N_PAR, nInversores=N_INV, inclinacion=TILT,
                 azimut=AZ_PVSYST, albedo=ALBEDO, b0=B0, Uc=29, Uv=0, perdidas=PERD),
    mensual=dict(ghi=mensual(ghi), poa=mensual(poa), efectiva=mensual(g_ef), eDC=mensual(pg), eAC=mensual(pac)),
    anual=dict(ghi=float(ghi.sum() / 1000), poa=float(poa.sum() / 1000), efectiva=float(g_ef.sum() / 1000),
               eDC=float(pg.sum() / 1000), eAC=float(pac.sum() / 1000),
               rendimiento=float(pac.sum() / p_stc), pr=float(pac.sum() / 1000 / (poa.sum() / 1000 * p_stc / 1000))),
    muestras=dict(horas=list(range(6, 8760, 37)), poa=poa[6::37].tolist(), tc=tc[6::37].tolist(), pDC=pg[6::37].tolist(), pAC=pac[6::37].tolist()),
)

dest_fx = os.path.join(RAIZ, 'src', 'engine', '__tests__', 'fixtures')
with open(os.path.join(dest_fx, 'casoIbarra.json'), 'w') as f:
    json.dump(ref, f, indent=0)
os.makedirs(os.path.join(RAIZ, 'public', 'data'), exist_ok=True)
with open(os.path.join(RAIZ, 'public', 'data', 'ibarra-sintetico.json'), 'w') as f:
    json.dump(clima, f)
print('GHI anual %.1f kWh/m², POA %.1f, E_AC %.1f kWh, Yf %.0f kWh/kWp, PR %.3f' % (
    ref['anual']['ghi'], ref['anual']['poa'], ref['anual']['eAC'], ref['anual']['rendimiento'], ref['anual']['pr']))
