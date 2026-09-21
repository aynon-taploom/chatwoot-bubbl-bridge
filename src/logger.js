/** A namespaced console logger, so every line is prefixed consistently (e.g. "[from-bubbl] ...")
 *  instead of each call site spelling that prefix out by hand. */
function createLogger(namespace) {
  const prefix = `[${namespace}]`;

  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

module.exports = { createLogger };
