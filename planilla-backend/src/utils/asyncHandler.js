// Envuelve un handler de Express async: si la promesa rechaza, el error
// se manda a next(err) en vez de convertirse en una excepción no capturada
// que tumbaría TODO el proceso (afectando a todas las empresas, no solo
// a la que disparó el error).
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
