// Which baby the watch is acting on. With one baby the switcher is hidden
// (hasChoice false); with several, the saved choice wins and the first baby
// is the fallback when nothing is saved or the saved baby is gone.

function resolveActiveBaby(babies, savedId) {
  if (babies.length === 0) return { baby: null, hasChoice: false };
  const saved = babies.find((b) => b.id === savedId);
  return { baby: saved || babies[0], hasChoice: babies.length > 1 };
}

module.exports = { resolveActiveBaby };
