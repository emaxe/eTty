/**
 * Интеграция PowerShell (pwsh 7 / Windows PowerShell 5.1) — аналог ZDOTDIR-хуков для zsh:
 * OSC 7 (cwd), OSC 133 A/C (idle/busy), OSC 6973 (путь к node), история вкладки, стиль промпта.
 *
 * Скрипт передаётся через `-EncodedCommand`, а не файлом: так не нужен `-ExecutionPolicy Bypass`
 * (он остался бы в сессии и разрешил бы запуск любых скриптов пользователя), и нет tmp-каталога.
 * Пользовательский $PROFILE грузится самим PowerShell ДО этой команды, поэтому наш prompt
 * оборачивает уже финальный (oh-my-posh, starship и т.п.).
 */

const PROMPT_STYLES = {
  short: { leaf: true, suffix: ' % ' },
  minimal: { leaf: false, suffix: '> ' },
  arrow: { leaf: true, suffix: ' ❯ ' }
}

/** Литерал PowerShell в одинарных кавычках: `'` удваивается, остальное буквально. */
export function psQuote(str) {
  return `'${String(str).replace(/'/g, "''")}'`
}

/**
 * @param {{ historyFile?: string|null, promptStyle?: string }} [params]
 * @returns {string} текст скрипта инициализации
 */
export function buildPwshInitScript({ historyFile = null, promptStyle = 'default' } = {}) {
  const style = PROMPT_STYLES[promptStyle]
  const lines = [
    // UTF-8 для вывода (❯, кириллица): в 5.1 по умолчанию OEM-кодировка
    'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}',
    '$global:__etty_node_path = $null; $global:__etty_node_for = $null',
    '$global:__etty_orig_prompt = $function:prompt',
    'function global:prompt {',
    '  $esc = [char]27; $bel = [char]7',
    "  $seq = ''",
    "  if ($PWD.Provider.Name -eq 'FileSystem') {",
    '    try { $seq += "$esc]7;" + ([System.Uri]$PWD.ProviderPath).AbsoluteUri + $bel } catch {}',
    '  }',
    '  if ($global:__etty_node_for -ne $env:Path) {',
    '    $global:__etty_node_for = $env:Path',
    "    $c = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    '    $global:__etty_node_path = if ($c) { $c.Source } else { $null }',
    '  }',
    '  $seq += "$esc]6973;node=" + $global:__etty_node_path + $bel',
    '  $seq += "$esc]133;A$bel"'
  ]
  if (style) {
    lines.push(
      '  $leaf = if ($PWD.Path -eq $HOME) { "~" } else { Split-Path -Leaf $PWD.Path }',
      '  if (-not $leaf) { $leaf = $PWD.Path }',
      `  return $seq + ${style.leaf ? '$leaf + ' : ''}${psQuote(style.suffix)}`
    )
  } else {
    lines.push(
      '  $orig = if ($global:__etty_orig_prompt) { & $global:__etty_orig_prompt } else { "PS " + $PWD.Path + "> " }',
      '  return $seq + $orig'
    )
  }
  lines.push(
    '}',
    // OSC 133 C (busy) перед выполнением введённой команды; пустой Enter busy не включает
    'if (Get-Module PSReadLine) {',
    '  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {',
    '    $line = $null; $cursor = $null',
    '    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)',
    '    if ($line -and $line.Trim()) { [Console]::Write([string][char]27 + "]133;C" + [char]7) }',
    '    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()',
    '  }'
  )
  if (historyFile) {
    lines.push(`  try { Set-PSReadLineOption -HistorySavePath ${psQuote(historyFile)} -HistorySaveStyle SaveIncrementally } catch {}`)
  }
  lines.push('}')
  return lines.join('\n') + '\n'
}

/**
 * Аргументы запуска PowerShell с интеграцией.
 * `-EncodedCommand` принимает base64 от UTF-16LE.
 */
export function buildPwshArgs(opts) {
  const encoded = Buffer.from(buildPwshInitScript(opts), 'utf16le').toString('base64')
  return ['-NoLogo', '-NoExit', '-EncodedCommand', encoded]
}
