"""
Genera valores de referencia con pvlib-python para los tests unitarios del motor (Vitest).
Uso:  pip install pvlib  &&  npm run fixtures
Salida: src/engine/__tests__/fixtures/*.json

Cada archivo contiene entradas + salidas esperadas; los tests en TypeScript recalculan
y comparan con tolerancias documentadas en cada test.
"""
import json
import os
import numpy as np
import pandas as pd
import pvlib
from pvlib import irradiance, iam, pvsystem, inverter, temperature, atmosphere, solarposition

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DESTINO = os.path.join(RAIZ, 'src', 'engine', '__tests__', 'fixtures')
SEMILLA = os.path.join(RAIZ, 'src', 'catalogo', 'semilla')
os.makedirs(DESTINO, exist_ok=True)

IBARRA = dict(lat=0.35, lon=-78.12, alt=2225.0)
rng = np.random.default_rng(20261016)


def guardar(nombre, datos):
    def conv(o):
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        if isinstance(o, (np.ndarray, pd.Series)):
            return [None if (isinstance(x, float) and not np.isfinite(x)) else x for x in np.asarray(o, dtype=float).tolist()]
        raise TypeError(type(o))
    with open(os.path.join(DESTINO, nombre), 'w') as f:
        json.dump(datos, f, default=conv, indent=0)
    print('  ', nombre)


def a_pvsyst(az_norte):
    """Azimut pvlib (0 = N, 90 = E) → PVsyst (0 = S, +90 = O)."""
    return np.asarray(az_norte) - 180.0


def spa():
    t = pd.date_range('2026-01-01 00:30', '2026-12-31 23:30', freq='97h', tz='UTC')
    sitios = [IBARRA, dict(lat=-2.17, lon=-79.92, alt=4.0), dict(lat=40.0, lon=-105.2, alt=1650.0)]
    casos = []
    for s in sitios:
        p = atmosphere.alt2pres(s['alt'])
        sp = solarposition.spa_python(t, s['lat'], s['lon'], altitude=s['alt'], pressure=p, temperature=12,
                                      delta_t=69, atmos_refract=0.5667)
        casos.append(dict(sitio=s, presion_hPa=p / 100, unix=(t.as_unit('s').asi8).tolist(),
                          cenit=sp['apparent_zenith'].values, elevacion=sp['apparent_elevation'].values,
                          azimutPVsyst=a_pvsyst(sp['azimuth'].values),
                          eot=sp['equation_of_time'].values))
    guardar('spa.json', casos)


def basicos():
    doy = np.arange(1, 366, 7)
    z = np.linspace(0, 89.5, 40)
    guardar('basicos.json', dict(
        doy=doy, extra=irradiance.get_extra_radiation(doy, method='spencer', solar_constant=1366.1),
        cenit=z, am=atmosphere.get_relative_airmass(z, model='kastenyoung1989')))


def perez():
    n = 300
    tilt = rng.uniform(0, 60, n)
    saz = rng.uniform(-180, 180, n)
    z = rng.uniform(0, 89, n)
    sazm = rng.uniform(-180, 180, n)
    dhi = rng.uniform(5, 400, n)
    dni = rng.uniform(0, 1000, n)
    extra = rng.uniform(1320, 1415, n)
    am = atmosphere.get_relative_airmass(z, model='kastenyoung1989')
    # pvlib usa azimut 0 = N; la diferencia de azimuts es la misma, se pasa +180 a ambos
    comp = irradiance.perez(tilt, saz + 180, dhi, dni, extra, z, sazm + 180, am, return_components=True)
    guardar('perez.json', dict(inclinacion=tilt, azimutPlano=saz, cenit=z, azimutSol=sazm, dhi=dhi, dni=dni,
                               extra=extra, am=am, total=comp['poa_sky_diffuse'],
                               isotropica=comp['poa_isotropic'], circunsolar=comp['poa_circumsolar'],
                               horizonte=comp['poa_horizon']))


def iams():
    a = np.linspace(0, 89.9, 60)
    tilts = [0, 10, 20, 35, 60, 90]
    guardar('iam.json', dict(
        aoi=a, ashrae005=iam.ashrae(a, 0.05), ashrae004=iam.ashrae(a, 0.04),
        fresnel=iam.physical(a, n=1.526, K=4, L=0.002),
        tilts=tilts,
        marionCieloAshrae=[iam.marion_diffuse('ashrae', t, b=0.05)['sky'] for t in tilts],
        marionSueloAshrae=[iam.marion_diffuse('ashrae', t, b=0.05)['ground'] for t in tilts],
        marionCieloFresnel=[iam.marion_diffuse('physical', t)['sky'] for t in tilts]))


def erbs():
    n = 200
    z = rng.uniform(0, 89, n)
    doy = rng.integers(1, 366, n)
    extra = irradiance.get_extra_radiation(doy, method='spencer', solar_constant=1366.1)
    ghi = rng.uniform(0, 1.0, n) * extra * np.maximum(np.cos(np.radians(z)), 0)
    r = irradiance.erbs(ghi, z, doy)
    # pvlib.erbs usa la constante solar por defecto de get_extra_radiation (1366.1)
    guardar('erbs.json', dict(ghi=ghi, cenit=z, extra=extra, dni=r['dni'], dhi=r['dhi']))


def termico():
    n = 100
    poa = rng.uniform(0, 1200, n)
    ta = rng.uniform(0, 35, n)
    ws = rng.uniform(0, 8, n)
    guardar('termico.json', dict(poa=poa, ta=ta, ws=ws,
                                 tc_29_0=temperature.pvsyst_cell(poa, ta, ws, u_c=29, u_v=0, module_efficiency=0.21, alpha_absorption=0.9),
                                 tc_25_12=temperature.pvsyst_cell(poa, ta, ws, u_c=25, u_v=1.2, module_efficiency=0.18, alpha_absorption=0.9)))


def un_diodo():
    mods = json.load(open(os.path.join(SEMILLA, 'modulosCEC.json')))
    g = np.array([50, 100, 200, 400, 600, 800, 1000, 1100, 1250])
    t = np.array([-10, 0, 15, 25, 40, 55, 70])
    G, T = [x.ravel() for x in np.meshgrid(g, t)]
    casos = []
    for m in mods:
        c = m['cec']
        tec = m['tecnologia'].lower()
        eg, deg = (1.475, -0.0003) if 'cdte' in tec else (1.121, -0.0002677)
        IL, I0, Rs, Rsh, nNsVth = pvsystem.calcparams_cec(G, T, c['alphaSc'], c['aRef'], c['ILref'], c['I0ref'],
                                                         c['RshRef'], c['Rs'], c['adjust'], EgRef=eg, dEgdT=deg)
        sd = pvsystem.singlediode(IL, I0, Rs, Rsh, nNsVth, method='lambertw')
        v = 0.6 * sd['v_oc']
        i_v = pvsystem.i_from_v(v, IL, I0, Rs, Rsh, nNsVth, method='lambertw')
        casos.append(dict(id=m['id'], g=G, t=T, IL=IL, I0=I0, Rsh=Rsh, nNsVth=nNsVth,
                          isc=sd['i_sc'], voc=sd['v_oc'], imp=sd['i_mp'], vmp=sd['v_mp'], pmp=sd['p_mp'],
                          v06=v, i06=i_v))
    guardar('unDiodo.json', casos)


def inversores():
    invs = json.load(open(os.path.join(SEMILLA, 'inversoresCEC.json')))
    casos = []
    for inv in invs:
        s = inv['sandia']
        p = pd.Series(dict(Paco=s['Paco'], Pdco=s['Pdco'], Vdco=s['Vdco'], Pso=s['Pso'], C0=s['C0'], C1=s['C1'],
                           C2=s['C2'], C3=s['C3'], Pnt=s['Pnt']))
        pdc = np.linspace(0, 1.3 * s['Pdco'], 40)
        vdc = np.linspace(s['MpptLow'], s['MpptHigh'], 40)
        rng.shuffle(vdc)
        pac = inverter.sandia(vdc, pdc, p)
        casos.append(dict(id=inv['id'], pdc=pdc, vdc=vdc, pac=pac))
    guardar('sandia.json', casos)


if __name__ == '__main__':
    print('pvlib', pvlib.__version__)
    spa(); basicos(); perez(); iams(); erbs(); termico(); un_diodo(); inversores()
