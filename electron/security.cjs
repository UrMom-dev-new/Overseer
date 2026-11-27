function sameOrigin(first, second) {
  try { return new URL(first).origin !== 'null' && new URL(first).origin === new URL(second).origin; }
  catch { return false; }
}

function safeExternalUrl(value) {
  try {
    if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return false;
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function localAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password;
  } catch { return false; }
}

function allowedLocalRequest(request, port) {
  const host = request.headers.host;
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
    || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)
    || !request.url?.startsWith('/') || request.url.startsWith('//')) return false;
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}`) return false;
  return !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']);
}

function trustedIpc(event, contents, appUrl, startupUrl) {
  if (!contents || contents.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
  const url = event.senderFrame?.url;
  return Boolean(url && (url === startupUrl || (appUrl && sameOrigin(appUrl, url))));
}

function configureSession(session, context = () => ({})) {
  // Viewing remote video does not require device, location, clipboard-read,
  // notification, or filesystem privileges.
  const allowed = (contents, permission, details) => {
    const trusted = context();
    return permission === 'clipboard-sanitized-write' && contents === trusted.contents
      && details?.isMainFrame === true && sameOrigin(trusted.url, details.requestingUrl);
  };
  session.setPermissionCheckHandler((contents, permission, _origin, details) => allowed(contents, permission, details));
  session.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowed(contents, permission, details)));
  session.setDevicePermissionHandler(() => false);
}

module.exports = { sameOrigin, safeExternalUrl, localAppUrl, allowedLocalRequest, trustedIpc, configureSession };
