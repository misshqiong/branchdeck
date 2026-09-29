const {signAsync} = require('@electron/osx-sign');

// electron-builder 26 replaces the selected certificate hash with its display
// name in its default signer. Two valid development certificates can share that
// name. Preserve the exact identity already resolved by electron-builder.
exports.sign = async options => {
  if (!/^[A-Fa-f0-9]{40}$/.test(options.identity || '')) {
    throw new Error('MAS development signing requires an exact certificate SHA-1.');
  }
  return signAsync(options);
};
