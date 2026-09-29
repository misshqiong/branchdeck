const development = process.env.BRANCHDECK_MAS_MODE === 'development';
const team = process.env.APPLE_TEAM_ID;
if (!team) throw new Error('Set APPLE_TEAM_ID for MAS signing.');
const identity = process.env[development ? 'MAS_DEVELOPMENT_IDENTITY' : 'MAS_DISTRIBUTION_IDENTITY'];
if (!identity) throw new Error('Set the MAS signing identity in the environment.');
const base = require('./package.json').build;
const entitlements = 'assets/entitlements.mas.plist';
const inherit = 'assets/entitlements.mas.inherit.plist';
module.exports = {
  ...base,
  extends: null,
  productName: 'BranchDeck Store',
  buildVersion: process.env.BRANCHDECK_BUILD_NUMBER || '1',
  afterPack: './scripts/prepare-mas-pty.cjs',
  directories: {output: development ? 'release-mas-dev' : 'release-mas'},
  mac: {...base.mac, target: development ? 'mas-dev' : 'mas', notarize: false},
  mas: {
    identity,
    type: 'distribution',
    hardenedRuntime: false,
    entitlements,
    entitlementsInherit: inherit,
    provisioningProfile: process.env.MAS_DISTRIBUTION_PROFILE || '.local/mas/distribution.provisionprofile',
    extendInfo: {ElectronTeamID: team}
  },
  masDev: {
    sign: './scripts/sign-mas.cjs',
    // This certificate is included in the local development provisioning profile.
    identity,
    type: 'development',
    hardenedRuntime: false,
    entitlements,
    entitlementsInherit: inherit,
    provisioningProfile: process.env.MAS_DEVELOPMENT_PROFILE || '.local/mas/development.provisionprofile',
    extendInfo: {ElectronTeamID: team}
  }
};
