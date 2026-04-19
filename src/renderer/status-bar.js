export class StatusBar {
  constructor({ btnEl, onOpen }) {
    this._btnEl = btnEl;
    this._onOpen = onOpen;
    this._getRootPath = null;
    this._intervalId = null;

    this._btnEl.addEventListener('click', () => this._onOpen());
  }

  start(getRootPath) {
    this._getRootPath = getRootPath;
    this._poll();
    this._intervalId = setInterval(() => this._poll(), 5000);
  }

  stop() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  updateNow() {
    this._poll();
  }

  async _poll() {
    try {
      const rootPath = this._getRootPath ? this._getRootPath() : null;

      if (!rootPath) {
        this._btnEl.classList.add('hidden');
        return;
      }

      const result = await window.electronAPI.gitGetStatus(rootPath);

      if (result.notARepo) {
        this._btnEl.classList.add('hidden');
        return;
      }

      this._btnEl.classList.remove('hidden');
      this._btnEl.textContent = `± +${result.totalAdditions} -${result.totalDeletions}`;
    } catch (e) {
      this._btnEl.classList.add('hidden');
    }
  }
}
