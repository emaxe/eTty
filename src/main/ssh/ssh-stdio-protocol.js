/**
 * Протокол stdio-канала служебных вызовов (Windows, где у OpenSSH нет ControlMaster).
 *
 * Одно долгоживущее `ssh -T target /bin/sh`: диспетчер (POSIX sh) приходит в stdin самого ssh,
 * после чего тот же поток несёт запросы. Удалённая команда — голое `/bin/sh` без кавычек,
 * поэтому ничто не зависит от правил квотирования argv на Windows и от login-shell сервера.
 *
 * Клиент → сервер (stdin):
 *   `R <id> <args> <script> <stdin>\n` — три поля в base64 (`-` — пусто)
 *   `K <id>\n`                         — прервать запрос
 *   args — текст `set -- 'a' 'b'\n` (POSIX-квотирование, допускает любые байты, включая \n);
 *   script исполняется как `/bin/sh <файл> "$@"`, stdin — из файла запроса.
 * Сервер → клиент (stdout), после маркера READY (всё, что было до него, — шум rc-файлов):
 *   `ETTY-RES <id> <exitCode> <lenStdout> <lenStderr>\n` + stdout + stderr
 *
 * Запросы исполняются параллельно (фоновые подоболочки), кадры ответов пишутся под
 * mkdir-мьютексом — они не перемешиваются. Запрос — одна строка с base64-полями, а не сырые байты:
 * `head -c N` на BSD/macOS читает с запасом и «съедает» следующие запросы, а побайтово точно читает
 * только `read`. Ответ бинарно-безопасен: фиксированные длины stdout/stderr, без раздувания.
 *
 * Диспетчер читает команды из того же stdin, что и сам sh: клиент обязан дождаться READY,
 * прежде чем слать запросы, — иначе sh прочитал бы запрос как продолжение скрипта.
 */

export const READY_MARKER = 'ETTY-READY'
export const RES_PREFIX = 'ETTY-RES'

/**
 * Скрипт диспетчера. После `done` строк нет: на EOF (ssh закрыт) sh завершается сам. Любая строка
 * после цикла была бы прочитана самим `read` как первый «запрос».
 * @param {string} nonce — уникальный токен, чтобы маркер READY не совпал с шумом
 */
export function buildDispatcherScript(nonce) {
  return [
    'd=$(mktemp -d "${TMPDIR:-/tmp}/etty-ch.XXXXXX") || exit 1',
    'trap \'rm -rf "$d"\' EXIT',
    'emit() {',
    // Каталога нет — диспетчер уже завершился (ssh закрыт): писать некому, не крутимся вхолостую
    '  until mkdir "$d/lock" 2>/dev/null; do [ -d "$d" ] || return 0; sleep 0.05 2>/dev/null || sleep 1; done',
    '  lo=$(( $(wc -c < "$d/$1.o") )); le=$(( $(wc -c < "$d/$1.e") ))',
    `  printf "${RES_PREFIX} %s %s %s %s\\n" "$1" "$2" "$lo" "$le"`,
    '  cat "$d/$1.o" "$d/$1.e"',
    '  rmdir "$d/lock"',
    '  rm -f "$d/$1".*',
    '}',
    // head -c 0 на BSD/macOS ждёт stdin и зависает — нулевую длину не читаем вовсе
    'if echo QQ== | base64 -d >/dev/null 2>&1; then b64d="base64 -d"; elif echo QQ== | base64 -D >/dev/null 2>&1; then b64d="base64 -D"; else b64d="openssl base64 -d -A"; fi',
    'dec() { if [ "$1" != - ]; then printf %s "$1" | $b64d; fi; }',
    `printf "${READY_MARKER} ${nonce}\\n"`,
    'while IFS=" " read -r op id fa fs fi_; do',
    '  case "$op" in',
    '    R)',
    '      dec "$fa" > "$d/$id.a"; dec "$fs" > "$d/$id.s"; dec "$fi_" > "$d/$id.i"',
    '      ( ( . "$d/$id.a"; exec /bin/sh "$d/$id.s" "$@" ) < "$d/$id.i" > "$d/$id.o" 2> "$d/$id.e"; emit "$id" "$?" ) &',
    '      echo $! > "$d/$id.p"',
    '      ;;',
    '    K) kill "$(cat "$d/$id.p" 2>/dev/null)" 2>/dev/null ;;',
    '  esac',
    'done',
    ''
  ].join('\n')
}

/** POSIX-квотирование одного аргумента (`'` → `'\''`); переводы строк внутри кавычек допустимы. */
export function posixQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/**
 * Кодирует запрос `R`.
 * @param {{ id: number|string, script: string, args?: string[], stdin?: Buffer|string }} req
 * @returns {Buffer}
 */
export function encodeRequest({ id, script, args = [], stdin }) {
  const b64 = (buf) => (buf.length ? buf.toString('base64') : '-')
  const argsBuf = Buffer.from(`set --${args.map(a => ` ${posixQuote(a)}`).join('')}\n`, 'utf-8')
  const stdinBuf = stdin === undefined ? Buffer.alloc(0) : Buffer.from(stdin)
  return Buffer.from(`R ${id} ${b64(argsBuf)} ${b64(Buffer.from(script, 'utf-8'))} ${b64(stdinBuf)}\n`, 'ascii')
}

export function encodeKill(id) {
  return Buffer.from(`K ${id}\n`, 'ascii')
}

/**
 * Потоковый разборщик stdout диспетчера: ждёт маркер READY, затем режет кадры ответов.
 * Строки, не похожие на заголовок кадра, пропускаются (ресинхронизация).
 */
export class FrameParser {
  /**
   * @param {{ nonce: string, onReady: () => void,
   *   onFrame: (frame: { id: string, code: number, stdout: Buffer, stderr: Buffer }) => void }} handlers
   */
  constructor({ nonce, onReady, onFrame }) {
    this._marker = Buffer.from(`${READY_MARKER} ${nonce}\n`, 'ascii')
    this._onReady = onReady
    this._onFrame = onFrame
    this._buf = Buffer.alloc(0)
    this._ready = false
    this._pending = null // { id, code, lo, le } — ждём тело кадра
  }

  get ready() {
    return this._ready
  }

  feed(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk
    for (;;) {
      if (!this._ready) {
        const at = this._buf.indexOf(this._marker)
        if (at === -1) {
          // Хвост, который ещё может оказаться началом маркера, оставляем; остальное — шум
          const keep = Math.min(this._buf.length, this._marker.length - 1)
          this._buf = this._buf.subarray(this._buf.length - keep)
          return
        }
        this._buf = this._buf.subarray(at + this._marker.length)
        this._ready = true
        this._onReady()
        continue
      }
      if (this._pending) {
        const need = this._pending.lo + this._pending.le
        if (this._buf.length < need) return
        const { id, code, lo } = this._pending
        const stdout = Buffer.from(this._buf.subarray(0, lo))
        const stderr = Buffer.from(this._buf.subarray(lo, need))
        this._buf = this._buf.subarray(need)
        this._pending = null
        this._onFrame({ id, code, stdout, stderr })
        continue
      }
      const nl = this._buf.indexOf(0x0a)
      if (nl === -1) return
      const line = this._buf.subarray(0, nl).toString('ascii')
      this._buf = this._buf.subarray(nl + 1)
      const m = /^ETTY-RES (\S+) (-?\d+) (\d+) (\d+)$/.exec(line)
      if (m) this._pending = { id: m[1], code: Number(m[2]), lo: Number(m[3]), le: Number(m[4]) }
    }
  }
}
