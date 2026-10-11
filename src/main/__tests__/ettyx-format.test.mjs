import {
  ETTYX_FORMAT,
  ETTYX_VERSION,
  ETTYX_PBKDF2_ITERATIONS,
  mapAuthTypeToPortable,
  mapAuthTypeFromPortable,
  buildEttyxPlaintext,
  encryptEttyx,
  decryptEttyx,
} from '../ssh/ettyx-format.js'

let failed = false
function assert(cond, message) {
  if (cond) {
    console.log(`PASS: ${message}`)
  } else {
    console.error(`FAIL: ${message}`)
    failed = true
  }
}

async function runTest() {
  // Test 1: authType mapping — оба направления, включая 'agent' (REQ-7)
  assert(mapAuthTypeToPortable('key') === 'privateKey', 'authType key -> privateKey')
  assert(mapAuthTypeToPortable('password') === 'password', 'authType password -> password')
  assert(mapAuthTypeToPortable('agent') === 'agent', 'authType agent -> agent (не подменяется)')
  assert(mapAuthTypeFromPortable('privateKey') === 'key', 'authType privateKey -> key')
  assert(mapAuthTypeFromPortable('password') === 'password', 'authType password -> password (обратно)')
  assert(mapAuthTypeFromPortable('agent') === 'agent', 'authType agent -> agent (обратно)')

  // Test 2: round-trip encrypt/decrypt с верным паролем
  const connections = [
    {
      id: 'abc-123',
      label: 'prod-web',
      host: 'example.com',
      port: 22,
      username: 'deploy',
      authType: 'password',
      persistence: 'tmux',
      tmuxSocket: 'etty',
      hooksEnabled: true,
      secrets: { password: 'hunter2' },
    },
    {
      id: 'def-456',
      label: 'db-box',
      host: '10.0.0.5',
      port: 2222,
      username: 'root',
      authType: 'privateKey',
      persistence: 'off',
      tmuxSocket: 'etty',
      hooksEnabled: false,
      secrets: { passphrase: 'keypass', privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\nAAA\n-----END OPENSSH PRIVATE KEY-----' },
    },
  ]
  const plaintext = buildEttyxPlaintext(connections, { exportedAt: '2026-09-23T00:00:00.000Z' })
  const parsedPlaintext = JSON.parse(plaintext)
  assert(parsedPlaintext.exportedAt === '2026-09-23T00:00:00.000Z', 'buildEttyxPlaintext сохраняет exportedAt')
  assert(parsedPlaintext.connections.length === 2, 'buildEttyxPlaintext сохраняет все подключения')

  const fileContents = encryptEttyx(plaintext, 'correct horse battery staple')
  const envelope = JSON.parse(fileContents)
  assert(envelope.format === ETTYX_FORMAT, 'конверт содержит format: ettyx')
  assert(envelope.version === ETTYX_VERSION, 'конверт содержит правильную version')
  assert(envelope.iterations === ETTYX_PBKDF2_ITERATIONS, 'конверт содержит iterations = 600000')
  assert(typeof envelope.salt === 'string' && envelope.salt.length > 0, 'конверт содержит salt (base64)')
  assert(typeof envelope.iv === 'string' && envelope.iv.length > 0, 'конверт содержит iv (base64)')
  assert(typeof envelope.ciphertext === 'string' && envelope.ciphertext.length > 0, 'конверт содержит ciphertext (base64)')
  assert(typeof envelope.authTag === 'string' && envelope.authTag.length > 0, 'конверт содержит authTag (base64)')

  const decrypted = decryptEttyx(fileContents, 'correct horse battery staple')
  assert(decrypted.exportedAt === '2026-09-23T00:00:00.000Z', 'decryptEttyx восстанавливает exportedAt')
  assert(JSON.stringify(decrypted.connections) === JSON.stringify(connections), 'decryptEttyx восстанавливает connections побайтово')

  // Test 3: неверный пароль -> ошибка, не тихий мусор
  try {
    decryptEttyx(fileContents, 'wrong password')
    console.error('FAIL: decryptEttyx с неверным паролем не бросил исключение')
    failed = true
  } catch (e) {
    assert(e.message.includes('Неверный пароль'), `decryptEttyx с неверным паролем бросает понятную ошибку: "${e.message}"`)
  }

  // Test 4: не-JSON / не-ettyx / неизвестная версия
  try {
    decryptEttyx('не json вообще', 'x')
    console.error('FAIL: decryptEttyx на не-JSON не бросил исключение')
    failed = true
  } catch (e) {
    assert(e.message.includes('повреждён') || e.message.includes('.ettyx'), 'decryptEttyx на не-JSON бросает понятную ошибку')
  }

  try {
    decryptEttyx(JSON.stringify({ format: 'something-else' }), 'x')
    console.error('FAIL: decryptEttyx на чужой format не бросил исключение')
    failed = true
  } catch (e) {
    assert(e.message.includes('.ettyx'), 'decryptEttyx на чужой format бросает понятную ошибку')
  }

  try {
    decryptEttyx(JSON.stringify({ format: ETTYX_FORMAT, version: 999 }), 'x')
    console.error('FAIL: decryptEttyx на неизвестную версию не бросил исключение')
    failed = true
  } catch (e) {
    assert(e.message.includes('версия'), 'decryptEttyx на неизвестную версию бросает понятную ошибку')
  }

  // Test 5: разные salt/iv на каждый вызов (не переиспользуем nonce)
  const second = encryptEttyx(plaintext, 'correct horse battery staple')
  const envelope2 = JSON.parse(second)
  assert(envelope.salt !== envelope2.salt, 'salt отличается между вызовами encryptEttyx')
  assert(envelope.iv !== envelope2.iv, 'iv отличается между вызовами encryptEttyx')
  assert(envelope.ciphertext !== envelope2.ciphertext, 'ciphertext отличается между вызовами (разный nonce)')

  if (failed) {
    console.error('\n❌ Some tests failed')
    process.exit(1)
  } else {
    console.log('\n✅ All tests passed')
  }
}

runTest().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
