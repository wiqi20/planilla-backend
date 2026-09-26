// Misma lógica de cálculo que usa el frontend, pero corriendo en el servidor.
// Esto importa: el cliente nunca debe ser la fuente de verdad de un monto de dinero.
// El frontend puede seguir mostrando una vista previa, pero lo que se GUARDA
// como colilla siempre se recalcula aquí con los datos crudos (horas, días).

const CCSS_RATE = 0.1083; // SEM 5.50% + IVM 4.33% + LPT 1% (vigente 2026)

const RENTA_BRACKETS_MONTHLY = [
  { upTo: 918000, rate: 0 },
  { upTo: 1347000, rate: 0.10 },
  { upTo: 2364000, rate: 0.15 },
  { upTo: 4727000, rate: 0.20 },
  { upTo: Infinity, rate: 0.25 }
];

function calcularRenta(brutoQuincenal) {
  const brutoMensualEquivalente = brutoQuincenal * 2;
  let renta = 0;
  let anterior = 0;
  for (const tramo of RENTA_BRACKETS_MONTHLY) {
    if (brutoMensualEquivalente > anterior) {
      const enTramo = Math.min(brutoMensualEquivalente, tramo.upTo) - anterior;
      renta += enTramo * tramo.rate;
      anterior = tramo.upTo;
    } else break;
  }
  return renta / 2;
}

function calcularPlanilla(salarioMensual, {
  horasExtra = 0, horasSinGoce = 0, diasVacaciones = 0,
  diasSinGoceCompletos = 0, diasIncapacidad = 0, diasLicenciaMP = 0, diasLicenciaCuido = 0,
  horasFeriado = 0
} = {}) {
  const salarioQuincenal = salarioMensual / 2;
  const salarioDiario = salarioMensual / 30;
  const salarioHora = salarioDiario / 8;

  const pagoExtra = horasExtra * salarioHora * 1.5;
  const deduccionSinGoce = horasSinGoce * salarioHora;
  const deduccionVacaciones = diasVacaciones * salarioDiario;
  const pagoVacaciones = diasVacaciones * salarioDiario;
  const deduccionSinGoceCompletos = diasSinGoceCompletos * salarioDiario;
  const pagoFeriado = horasFeriado * salarioHora * 1.0;

  const diasIncapPatronal = Math.min(diasIncapacidad, 3);
  const diasIncapCaja = Math.max(0, Math.min(diasIncapacidad, 15) - diasIncapPatronal);
  const diasIncapSinCobertura = Math.max(0, diasIncapacidad - 15);
  const deduccionIncapacidad = diasIncapacidad * salarioDiario;
  const pagoPatronoIncapacidad = diasIncapPatronal * salarioDiario * 0.40;
  const pagoCajaIncapacidad = diasIncapCaja * salarioDiario * 0.60;

  const deduccionLicenciaMP = diasLicenciaMP * salarioDiario;
  const pagoPatronoLicenciaMP = diasLicenciaMP * salarioDiario * 0.50;
  const pagoCajaLicenciaMP = diasLicenciaMP * salarioDiario * 0.50;

  const deduccionLicenciaCuido = diasLicenciaCuido * salarioDiario;
  const pagoPatronoLicenciaCuido = 0;
  const pagoCajaLicenciaCuido = diasLicenciaCuido * salarioDiario * 1.00;

  const brutoQuincenal = salarioQuincenal
    + pagoExtra
    + pagoFeriado
    - deduccionSinGoce
    - deduccionSinGoceCompletos
    - deduccionVacaciones + pagoVacaciones
    - deduccionIncapacidad + pagoPatronoIncapacidad
    - deduccionLicenciaMP + pagoPatronoLicenciaMP
    - deduccionLicenciaCuido + pagoPatronoLicenciaCuido;

  const renta = calcularRenta(brutoQuincenal);
  const ccss = brutoQuincenal * CCSS_RATE;
  const neto = brutoQuincenal - ccss - renta;

  return {
    salarioQuincenal, salarioDiario, salarioHora,
    pagoExtra, deduccionSinGoce, deduccionVacaciones, pagoVacaciones,
    deduccionSinGoceCompletos, pagoFeriado,
    diasIncapPatronal, diasIncapCaja, diasIncapSinCobertura,
    deduccionIncapacidad, pagoPatronoIncapacidad, pagoCajaIncapacidad,
    deduccionLicenciaMP, pagoPatronoLicenciaMP, pagoCajaLicenciaMP,
    deduccionLicenciaCuido, pagoPatronoLicenciaCuido, pagoCajaLicenciaCuido,
    brutoQuincenal, renta, ccss, neto
  };
}

module.exports = { calcularPlanilla, calcularRenta, CCSS_RATE };
