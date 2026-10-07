// Integration records are workspace-local and the app has no server-side secret vault.
// Keep known credentials out of both local storage and plain JSON backups.
const SECRET_FIELDS = new Set([
  'apikey', 'apitoken', 'token', 'authtoken', 'accesstoken', 'refreshtoken',
  'apiaccesstoken', 'oauthaccesstoken', 'oauthrefreshtoken', 'bearertoken',
  'clientsecret', 'clienttoken', 'oauthclientsecret', 'consumerkey', 'consumersecret',
  'accesskey', 'secretaccesskey', 'secret', 'secretkey', 'privatekey',
  'signingkey', 'encryptionkey', 'password', 'credential', 'credentials', 'authorization',
])

const fieldKey = (key) => String(key).replace(/[^a-z0-9]/gi, '').toLowerCase()
const isSecretField = (key) => SECRET_FIELDS.has(fieldKey(key))

/** True when a value contains an integration credential field at any depth. */
export function hasIntegrationSecrets(value) {
  if (Array.isArray(value)) return value.some(hasIntegrationSecrets)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, nested]) => isSecretField(key) || hasIntegrationSecrets(nested))
}

/** Return a copy with integration credentials removed, including nested credential bundles. */
export function stripIntegrationSecrets(value) {
  if (Array.isArray(value)) return value.map(stripIntegrationSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSecretField(key))
      .map(([key, nested]) => [key, stripIntegrationSecrets(nested)]),
  )
}
