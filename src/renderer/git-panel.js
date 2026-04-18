export class GitPanel {
  constructor({ overlayEl, onClose }) {
    this._overlayEl = overlayEl;
    this._onClose = onClose;
    this._rootPath = null;
    this._expandedFile = null;
    this._errorTimer = null;

    this._bindEvents();
  }

  _bindEvents() {
    const el = this._overlayEl;

    // Esc key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible()) {
        this.hide();
      }
    });

    // Close button
    const closeBtn = el.querySelector('.git-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Branch select
    const branchSelect = el.querySelector('#git-branch-select');
    if (branchSelect) {
      branchSelect.addEventListener('change', async (e) => {
        const branch = e.target.value;
        const result = await window.electronAPI.gitCheckout(this._rootPath, branch);
        if (result && result.error) {
          this._showError(result.error);
        } else {
          await this._loadStatus();
          await this._loadBranches();
        }
      });
    }

    // New branch button
    const newBranchBtn = el.querySelector('#git-branch-new');
    if (newBranchBtn) {
      newBranchBtn.addEventListener('click', () => {
        const existing = el.querySelector('.git-branch-input');
        if (existing) return;

        const input = document.createElement('input');
        input.className = 'git-branch-input';
        input.placeholder = 'branch name';
        newBranchBtn.parentNode.insertBefore(input, newBranchBtn);
        input.focus();

        input.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            const name = input.value.trim();
            if (!name) return;
            input.remove();
            const result = await window.electronAPI.gitCreateBranch(this._rootPath, name);
            if (result && result.error) {
              this._showError(result.error);
            } else {
              await this._loadStatus();
              await this._loadBranches();
            }
          } else if (e.key === 'Escape') {
            input.remove();
          }
        });
      });
    }

    // Delete branch button
    const deleteBranchBtn = el.querySelector('#git-branch-delete');
    if (deleteBranchBtn) {
      deleteBranchBtn.addEventListener('click', async () => {
        const branchSelect = el.querySelector('#git-branch-select');
        if (!branchSelect) return;

        const currentBranch = branchSelect.value;
        if (currentBranch === 'main' || currentBranch === 'master') {
          this._showError('Cannot delete main/master branch');
          return;
        }
        if (branchSelect.options.length <= 1) {
          this._showError('Cannot delete the only branch');
          return;
        }

        const result = await window.electronAPI.gitDeleteBranch(this._rootPath, currentBranch);
        if (result && result.error) {
          this._showError(result.error);
        } else {
          await this._loadStatus();
          await this._loadBranches();
        }
      });
    }

    // Commit button
    const commitBtn = el.querySelector('#git-btn-commit');
    if (commitBtn) {
      commitBtn.addEventListener('click', () => this._doCommit());
    }

    // Push button
    const pushBtn = el.querySelector('#git-btn-push');
    if (pushBtn) {
      pushBtn.addEventListener('click', () => this._doPush());
    }

    // Discard button
    const discardBtn = el.querySelector('#git-btn-discard');
    if (discardBtn) {
      discardBtn.addEventListener('click', () => this._confirmDiscard());
    }
  }

  show(rootPath) {
    this._rootPath = rootPath;
    this._overlayEl.classList.remove('hidden');
    this._loadStatus();
    this._loadBranches();
  }

  hide() {
    this._overlayEl.classList.add('hidden');
    this._rootPath = null;
    this._onClose();
  }

  isVisible() {
    return !this._overlayEl.classList.contains('hidden');
  }

  async _loadStatus() {
    if (!this._rootPath) return;
    const result = await window.electronAPI.gitGetStatus(this._rootPath);
    if (result && result.error) {
      this._showError(result.error);
      return;
    }
    this._renderFileList(result && result.files ? result.files : []);
  }

  async _loadBranches() {
    if (!this._rootPath) return;
    const result = await window.electronAPI.gitGetBranches(this._rootPath);
    if (result && result.error) {
      this._showError(result.error);
      return;
    }

    const branchSelect = this._overlayEl.querySelector('#git-branch-select');
    if (!branchSelect) return;

    branchSelect.innerHTML = '';
    const branches = result && result.all ? result.all : [];
    const current = result && result.current ? result.current : null;

    branches.forEach((branch) => {
      const option = document.createElement('option');
      option.value = branch;
      option.textContent = branch;
      if (branch === current) {
        option.selected = true;
      }
      branchSelect.appendChild(option);
    });
  }

  _renderFileList(files) {
    const fileList = this._overlayEl.querySelector('#git-file-list');
    if (!fileList) return;

    fileList.innerHTML = '';
    this._expandedFile = null;

    files.forEach((file) => {
      const row = document.createElement('div');
      row.className = 'git-file-row';
      row.dataset.filePath = file.path;

      const arrow = document.createElement('span');
      arrow.className = 'git-file-arrow';
      arrow.textContent = '▶';

      const path = document.createElement('span');
      path.className = 'git-file-path';
      path.textContent = file.path;

      const additions = document.createElement('span');
      additions.className = 'git-additions';
      additions.textContent = `+${file.additions !== undefined ? file.additions : 0}`;

      const deletions = document.createElement('span');
      deletions.className = 'git-deletions';
      deletions.textContent = `-${file.deletions !== undefined ? file.deletions : 0}`;

      row.appendChild(arrow);
      row.appendChild(path);
      row.appendChild(additions);
      row.appendChild(deletions);

      const diffBlock = document.createElement('div');
      diffBlock.className = 'git-diff-block';

      row.addEventListener('click', async () => {
        const isExpanded = row.classList.contains('expanded');

        // Collapse all
        const allRows = fileList.querySelectorAll('.git-file-row');
        allRows.forEach((r) => {
          r.classList.remove('expanded');
          const arrow = r.querySelector('.git-file-arrow');
          if (arrow) arrow.textContent = '▶';
        });
        const allDiffs = fileList.querySelectorAll('.git-diff-block');
        allDiffs.forEach((d) => d.classList.remove('visible'));

        if (!isExpanded) {
          row.classList.add('expanded');
          arrow.textContent = '▼';
          await this._renderDiff(file.path, diffBlock);
          diffBlock.classList.add('visible');
          this._expandedFile = file.path;
        } else {
          this._expandedFile = null;
        }
      });

      fileList.appendChild(row);
      fileList.appendChild(diffBlock);
    });
  }

  async _renderDiff(filePath, diffBlock) {
    if (!diffBlock) return;
    diffBlock.innerHTML = '';

    const result = await window.electronAPI.gitGetDiff(this._rootPath, filePath);
    const diffStr = typeof result === 'string' ? result : '';
    const lines = this._parseDiff(diffStr);

    lines.forEach((line) => {
      const div = document.createElement('div');
      const content = document.createTextNode(line.content);

      if (line.type === 'add') {
        div.className = 'diff-line diff-line-add';
      } else if (line.type === 'del') {
        div.className = 'diff-line diff-line-del';
      } else if (line.type === 'hunk') {
        div.className = 'diff-line diff-line-hunk';
      } else {
        div.className = 'diff-line';
      }

      div.appendChild(content);
      diffBlock.appendChild(div);
    });
  }

  _parseDiff(diffStr) {
    if (!diffStr) return [];
    const lines = diffStr.split('\n');
    const result = [];

    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        result.push({ type: 'ctx', content: line });
      } else if (line.startsWith('+')) {
        result.push({ type: 'add', content: line });
      } else if (line.startsWith('-')) {
        result.push({ type: 'del', content: line });
      } else if (line.startsWith('@@')) {
        result.push({ type: 'hunk', content: line });
      } else {
        result.push({ type: 'ctx', content: line });
      }
    }

    return result;
  }

  _showError(msg) {
    const bar = this._overlayEl.querySelector('#git-error-bar');
    if (!bar) return;

    if (this._errorTimer) {
      clearTimeout(this._errorTimer);
      this._errorTimer = null;
    }

    bar.textContent = msg;
    bar.classList.remove('success');
    bar.classList.add('visible');

    this._errorTimer = setTimeout(() => {
      bar.classList.remove('visible');
      this._errorTimer = null;
    }, 4000);
  }

  _showSuccess(msg) {
    const bar = this._overlayEl.querySelector('#git-error-bar');
    if (!bar) return;

    if (this._errorTimer) {
      clearTimeout(this._errorTimer);
      this._errorTimer = null;
    }

    bar.textContent = msg;
    bar.classList.add('visible', 'success');

    this._errorTimer = setTimeout(() => {
      bar.classList.remove('visible', 'success');
      this._errorTimer = null;
    }, 2000);
  }

  _setActionsDisabled(bool) {
    const el = this._overlayEl;
    const ids = ['#git-btn-commit', '#git-btn-push', '#git-btn-discard', '#git-commit-msg'];
    ids.forEach((id) => {
      const node = el.querySelector(id);
      if (node) node.disabled = bool;
    });
  }

  async _doCommit() {
    const msgInput = this._overlayEl.querySelector('#git-commit-msg');
    if (!msgInput) return;

    const msg = msgInput.value.trim();
    if (!msg) {
      this._showError('Commit message cannot be empty');
      return;
    }

    this._setActionsDisabled(true);
    const result = await window.electronAPI.gitCommit(this._rootPath, msg);

    if (result && result.error) {
      this._showError(result.error);
    } else {
      msgInput.value = '';
      await this._loadStatus();
    }

    this._setActionsDisabled(false);
  }

  async _doPush() {
    const pushBtn = this._overlayEl.querySelector('#git-btn-push');
    const originalText = pushBtn ? pushBtn.textContent : '';

    this._setActionsDisabled(true);
    if (pushBtn) pushBtn.textContent = '...';

    const result = await window.electronAPI.gitPush(this._rootPath);

    if (result && result.error) {
      this._showError(result.error);
    } else {
      this._showSuccess('Pushed successfully');
    }

    if (pushBtn) pushBtn.textContent = originalText;
    this._setActionsDisabled(false);
  }

  _confirmDiscard() {
    const discardBtn = this._overlayEl.querySelector('#git-btn-discard');
    if (!discardBtn) return;

    const parent = discardBtn.parentNode;

    // Create inline confirmation
    const confirmWrapper = document.createElement('span');
    confirmWrapper.className = 'git-discard-confirm';

    const label = document.createTextNode('Сбросить? ');
    const yesBtn = document.createElement('button');
    yesBtn.textContent = 'Да';
    const noBtn = document.createElement('button');
    noBtn.textContent = 'Нет';

    confirmWrapper.appendChild(label);
    confirmWrapper.appendChild(yesBtn);
    confirmWrapper.appendChild(noBtn);

    discardBtn.style.display = 'none';
    parent.insertBefore(confirmWrapper, discardBtn);

    yesBtn.addEventListener('click', async () => {
      confirmWrapper.remove();
      discardBtn.style.display = '';
      const result = await window.electronAPI.gitDiscard(this._rootPath);
      if (result && result.error) {
        this._showError(result.error);
      } else {
        await this._loadStatus();
      }
    });

    noBtn.addEventListener('click', () => {
      confirmWrapper.remove();
      discardBtn.style.display = '';
    });
  }
}
