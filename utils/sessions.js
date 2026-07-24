const sessions = new Map();

function getSession(chatId) {
  return sessions.get(chatId) || null;
}

function startSession(chatId) {
  const session = {
    step: "awaiting_title",
    data: { title: null, description: null, template: null, bgImageUrl: null },
  };
  sessions.set(chatId, session);
  return session;
}

function updateSession(chatId, patch) {
  const session = sessions.get(chatId);
  if (!session) return null;
  Object.assign(session, patch);
  sessions.set(chatId, session);
  return session;
}

function clearSession(chatId) {
  sessions.delete(chatId);
}

module.exports = { getSession, startSession, updateSession, clearSession };
