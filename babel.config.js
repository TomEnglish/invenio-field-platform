module.exports = function (api) {
  api.cache(true);
  // Zustand's ESM middleware uses import.meta; Expo serves a classic web bundle.
  return { presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]] };
};
