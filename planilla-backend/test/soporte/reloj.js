// Se carga con `node --require` en el servidor de pruebas: si existe FAKE_NOW (fecha ISO),
// el reloj del proceso arranca en ese instante y sigue avanzando. Sirve para simular "las 8 p. m. en Costa Rica".
if (process.env.FAKE_NOW) {
  const RealDate = Date;
  const desfase = RealDate.parse(process.env.FAKE_NOW) - RealDate.now();
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + desfase);
      else super(...args);
    }
    static now() { return RealDate.now() + desfase; }
  };
}
