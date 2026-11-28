// Record the exact Explorer request on runners without a visible desktop.
async function recordPortableSelection(instance, receipt, filename) {
  await instance.evaluate(({ app }, { receipt, filename }) => {
    const childProcess = process.getBuiltinModule('node:child_process');
    const { EventEmitter } = process.getBuiltinModule('node:events');
    const path = process.getBuiltinModule('node:path');
    const original = childProcess.spawn;
    childProcess.spawn = function (command, args, options) {
      if (command !== path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe')) return original.call(this, command, args, options);
      if (args.length !== 1 || args[0] !== `/select,"${filename}"` || !options.windowsVerbatimArguments || !options.detached || options.shell) {
        throw new Error('Explorer must select only the verified portable file.');
      }
      process.getBuiltinModule('node:fs').writeFileSync(receipt, JSON.stringify({ filename, stillOwnsProfile: app.hasSingleInstanceLock() }));
      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => child.emit('spawn'));
      return child;
    };
  }, { receipt, filename });
}
module.exports = { recordPortableSelection };
