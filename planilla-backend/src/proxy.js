// Cuántos proxies hay delante del servicio. En Railway hay uno (su balanceador), que agrega la IP real
// del cliente al final de X-Forwarded-For; con `1` Express toma esa IP y no la del proxy. Sin esto el
// límite de intentos de login contaría a todo el mundo como una sola IP (la del proxy). Si el servicio
// se corre sin proxy (local), es `false` para que nadie pueda inventar su IP con esa cabecera.
// Orden de decisión: 1) TRUST_PROXY explícito (0, 1, 2...); 2) variables que Railway inyecta solo en sus
// servicios; 3) NODE_ENV=production; 4) false.
const VARIABLES_RAILWAY = ['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME'];

function decidirProxy(env = process.env) {
  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY !== '') {
    const n = Number(env.TRUST_PROXY);
    const valor = Number.isInteger(n) && n > 0 ? n : false;
    return { valor, motivo: `variable TRUST_PROXY=${env.TRUST_PROXY}${valor === false && n !== 0 ? ' (no válida, se usa false)' : ''}` };
  }
  const railway = VARIABLES_RAILWAY.find((v) => env[v]);
  if (railway) return { valor: 1, motivo: `se detectó Railway (${railway})` };
  if (env.NODE_ENV === 'production') return { valor: 1, motivo: 'NODE_ENV=production' };
  return { valor: false, motivo: 'no hay TRUST_PROXY, ni Railway, ni NODE_ENV=production' };
}

module.exports = { decidirProxy };
