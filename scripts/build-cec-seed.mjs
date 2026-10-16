// Genera el catálogo semilla (Fase 1) a partir de la base CEC de NREL SAM.
// Uso: npm run catalogo:semilla   (descarga los CSV si no están en scripts/.cache)
// Fuente: https://github.com/NREL/SAM/tree/develop/deploy/libraries (licencia BSD-3)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(raiz, 'scripts', '.cache');
const URL_BASE = 'https://raw.githubusercontent.com/NREL/SAM/develop/deploy/libraries/';

const MODULOS = [
  'Jinko Solar Co Ltd JKM560N-72HL4-TV',
  'LONGi Green Energy Technology Co Ltd LR5-72HPH-550M',
  'JA Solar JAM72S30-550/MR',
  'Trina Solar TSM-550DE19',
  'Jinko Solar Co Ltd JKM420N-54HL4-B',
  'Trina Solar TSM-610NEG19RC20',
  'First Solar Inc FS-6450A',
];
const INVERSORES = [
  'Fronius International GmbH: Fronius Primo 38-1 208-240 {240V}',
  'Fronius International GmbH: Fronius Primo 50-1 208-240 {240V}',
  'Huawei Technologies Co Ltd: SUN2000-5KTL-USL0 {240V}',
  'Shenzhen Growatt New Energy Co Ltd: MIN 3000TL-XH-US {240V}',
  'Shenzhen Growatt New Energy Co Ltd: MIN 5000TL-XH-US {240V}',
  'Fronius International GmbH: Fronius Symo 100-3 208-240 {240V}',
  'Huawei Technologies Co Ltd: SUN2000-30KTL-US {480V}',
];

async function obtener(nombre, archivo) {
  const ruta = join(cache, archivo);
  if (!existsSync(ruta)) {
    mkdirSync(cache, { recursive: true });
    const r = await fetch(URL_BASE + encodeURIComponent(nombre));
    if (!r.ok) throw new Error(`No se pudo descargar ${nombre}: ${r.status}`);
    writeFileSync(ruta, await r.text());
  }
  return readFileSync(ruta, 'utf8');
}

/** CSV con comillas → filas de objetos (salta las 2 filas de unidades/claves SAM). */
export function leerCSV(texto) {
  const filas = [];
  let campo = '';
  let fila = [];
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  const [cab, , , ...datos] = filas;
  return datos.filter((f) => f.length > 5).map((f) => Object.fromEntries(cab.map((k, j) => [k, f[j]])));
}

const num = (x) => (x === undefined || x === '' ? null : Number(x));
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function convertirModulo(r) {
  return {
    id: 'cec-' + slug(r.Name),
    origen: 'cec',
    fabricante: r.Manufacturer,
    modelo: r.Name.replace(r.Manufacturer, '').trim() || r.Name,
    tecnologia: r.Technology,
    bifacial: r.Bifacial === '1',
    pNom: num(r.STC),
    area: num(r.A_c),
    largo: num(r.Length),
    ancho: num(r.Width),
    Ns: num(r.N_s),
    Isc: num(r.I_sc_ref),
    Voc: num(r.V_oc_ref),
    Imp: num(r.I_mp_ref),
    Vmp: num(r.V_mp_ref),
    alphaSc: num(r.alpha_sc),
    betaVoc: num(r.beta_oc),
    gammaPmp: num(r.gamma_pmp),
    tNoct: num(r.T_NOCT),
    cec: {
      aRef: num(r.a_ref),
      ILref: num(r.I_L_ref),
      I0ref: num(r.I_o_ref),
      Rs: num(r.R_s),
      RshRef: num(r.R_sh_ref),
      alphaSc: num(r.alpha_sc),
      adjust: num(r.Adjust),
    },
    precio: null,
  };
}

export function convertirInversor(r) {
  const [fab, resto] = r.Name.split(': ');
  return {
    id: 'cec-' + slug(r.Name),
    origen: 'cec',
    fabricante: fab,
    modelo: resto ?? r.Name,
    vac: num(r.Vac),
    fases: num(r.Vac) >= 400 ? 3 : 1,
    sandia: {
      Paco: num(r.Paco), Pdco: num(r.Pdco), Vdco: num(r.Vdco), Pso: num(r.Pso),
      C0: num(r.C0), C1: num(r.C1), C2: num(r.C2), C3: num(r.C3), Pnt: num(r.Pnt),
      Vdcmax: num(r.Vdcmax), Idcmax: num(r.Idcmax), MpptLow: num(r.Mppt_low), MpptHigh: num(r.Mppt_high),
    },
    // Voltaje máximo absoluto de entrada (ficha técnica). La CEC solo publica el máximo de operación.
    vdcMaxEntrada: null,
    // Corriente máxima de entrada (ficha técnica). El campo Idcmax de la CEC es un valor de ensayo, no el límite.
    idcMaxEntrada: null,
    numMppt: null,
    precio: null,
  };
}

async function main() {
  const mods = leerCSV(await obtener('CEC Modules.csv', 'cec_modules.csv'));
  const invs = leerCSV(await obtener('CEC Inverters.csv', 'cec_inverters.csv'));
  const selM = MODULOS.map((n) => {
    const r = mods.find((m) => m.Name === n);
    if (!r) throw new Error('Módulo no encontrado: ' + n);
    return convertirModulo(r);
  });
  const selI = INVERSORES.map((n) => {
    const r = invs.find((m) => m.Name === n);
    if (!r) throw new Error('Inversor no encontrado: ' + n);
    return convertirInversor(r);
  });
  const destino = join(raiz, 'src', 'catalogo', 'semilla');
  mkdirSync(destino, { recursive: true });
  writeFileSync(join(destino, 'modulosCEC.json'), JSON.stringify(selM, null, 1) + '\n');
  writeFileSync(join(destino, 'inversoresCEC.json'), JSON.stringify(selI, null, 1) + '\n');
  console.log(`Semilla: ${selM.length} módulos, ${selI.length} inversores → ${destino}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
