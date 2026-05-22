export const BINARY_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp',
  // Audio
  '.mp3', '.wav', '.ogg', '.flac',
  // Video
  '.mp4', '.avi', '.mov', '.mkv', '.webm',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Executables / installers
  '.exe', '.dmg', '.msi', '.dll', '.so', '.dylib', '.bin',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Compiled / DB
  '.sqlite', '.db', '.o', '.a', '.class', '.pyc', '.node', '.wasm'
])

export function isBinaryPath(filePath) {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return false
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase())
}
