/**
 * relay. workspace adapter
 *
 * Four small view components. Each has one reason to change:
 *   WorkspaceDevices      → discover/select a recipient
 *   WorkspaceComposer     → compose and dispatch existing PairDrop events
 *   WorkspaceSessionLog   → render short-lived, in-memory activity
 *   PersonalWorkspace     → connect those views to upstream events
 *
 * No monkey-patching, no new transfer protocol, no new persistence.
 */

class WorkspaceDevices {
    constructor(root, onSelectionChanged) {
        this.root = root;
        this.onSelectionChanged = onSelectionChanged;
        this.selectedId = null;
        this.shareModeActive = false;
        this.unreadCounts = new Map();

        this.root.setAttribute('role', 'listbox');
        this.root.setAttribute('aria-label', '在线设备');
        this.bindSelection();
    }

    getPeers() {
        // Upstream treats every open browser tab as a discoverable peer.
        // Other tabs on this same browser are not separate physical devices.
        return [...this.root.querySelectorAll('x-peer:not(.type-same-browser)')];
    }

    current() {
        return this.getPeers().find(peer => peer.id === this.selectedId);
    }

    bindSelection() {
        // Upstream labels open the native file picker. A regular workspace
        // click selects a peer instead, leaving the explicit attach action to
        // WorkspaceComposer. Upstream share mode is deliberately untouched.
        this.root.addEventListener('click', event => {
            if (this.shareModeActive) return;
            const peer = event.target.closest('x-peer');
            if (!peer || peer.hasAttribute('status')) return;
            event.preventDefault();
            this.select(peer.id, true);
        }, true);

        this.root.addEventListener('keydown', event => {
            const peer = event.target.closest('x-peer');
            if (peer !== event.target || this.shareModeActive) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this.select(peer.id, true);
        });
    }

    select(peerId, userInitiated = false) {
        if (!this.getPeers().some(peer => peer.id === peerId)) return;
        this.selectedId = peerId;
        this.unreadCounts.delete(peerId);
        this.refresh();
        this.onSelectionChanged(userInitiated);
    }

    onPeerAdded() {
        const peers = this.getPeers();

        // A previously selected tab can become hidden as its browser identity
        // is detected. Always select from genuine remote devices.
        if (this.selectedId && !peers.some(peer => peer.id === this.selectedId)) {
            this.selectedId = null;
        }
        if (!this.selectedId && peers.length === 1) {
            this.selectedId = peers[0].id;
        }

        this.refresh();
        this.onSelectionChanged(false);
    }

    onPeerDisconnected(peerId) {
        this.unreadCounts.delete(peerId);
        if (this.selectedId === peerId) this.selectedId = null;
        this.refresh();
        this.onSelectionChanged(false);
    }

    markIncoming(peerId) {
        if (!this.getPeers().some(peer => peer.id === peerId)) return;

        // Show the first incoming conversation immediately, otherwise keep
        // the chosen recipient and mark the sender as having unread messages.
        if (!this.selectedId) {
            this.select(peerId);
        } else if (this.selectedId !== peerId) {
            const previous = this.unreadCounts.get(peerId) || 0;
            this.unreadCounts.set(peerId, Math.min(previous + 1, 99));
            this.refresh();
        }
    }

    setShareMode(active) {
        this.shareModeActive = active;
        this.refresh();
    }

    refresh() {
        const peers = this.getPeers();
        this.root.closest('.workspace-devices')
            .classList.toggle('workspace-empty-visible', peers.length === 0);

        peers.forEach(peer => {
            const selected = peer.id === this.selectedId;
            const unread = this.unreadCounts.get(peer.id) || 0;

            peer.classList.toggle('workspace-selected', selected);
            peer.classList.toggle('workspace-unread', unread > 0);
            peer.dataset.unreadCount = unread ? String(unread) : '';
            peer.setAttribute('role', 'option');
            peer.setAttribute('aria-selected', String(selected));
            peer.tabIndex = 0;

            if (!this.shareModeActive) {
                peer.querySelector('label').title =
                    '选择设备。发送文件请使用右侧文件按钮。';
            }
        });
    }
}


/**
 * Browser file chooser bridge.
 *
 * Different choices route to a document picker, image picker or camera.
 * If Android suspends the page, selected files
 * are kept as a local draft until an online recipient can be confirmed.
 */
/**
 * App-owned upload chooser. Platform-owned Android chooser sheets cannot be
 * extended. This accessible sheet offers explicit routes into native pickers.
 */
class WorkspaceUploadSheet {
    constructor(root, onChoose) {
        this.panel = root.querySelector('#workspace-picker');
        this.trigger = root.querySelector('#workspace-file-button');
        this.choices = [...this.panel.querySelectorAll('[data-workspace-pick]')];
        this.onChoose = onChoose;
        this.bind();
    }

    bind() {
        const closeIds = [
            '#workspace-picker-close',
            '#workspace-picker-cancel',
            '#workspace-picker-backdrop'
        ];
        for (const id of closeIds) {
            this.panel.querySelector(id).addEventListener('click', () => this.close());
        }
        for (const choice of this.choices) {
            choice.addEventListener('click', () => {
                const kind = choice.dataset.workspacePick;
                this.close(false);
                this.onChoose(kind);
            });
        }
        this.panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.close();
            }
            // Small modal focus loop; hidden browser file inputs aren't tabbable.
            if (event.key === 'Tab') {
                const focusables = [
                    this.panel.querySelector('#workspace-picker-close'),
                    ...this.choices,
                    this.panel.querySelector('#workspace-picker-cancel')
                ];
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
    }

    open() {
        this.panel.hidden = false;
        this.choices[0].focus();
    }

    close(restoreFocus = true) {
        this.panel.hidden = true;
        if (restoreFocus) this.trigger.focus();
    }
}

class WorkspaceAttachments {
    constructor(root, canSend, recipientId, sendFiles) {
        this.canSend = canSend;
        this.recipientId = recipientId;
        this.sendFiles = sendFiles;
        this.fileInput = root.querySelector('#workspace-file-input');
        this.imageInput = root.querySelector('#workspace-image-input');
        this.cameraInput = root.querySelector('#workspace-camera-input');
        this.videoInput = root.querySelector('#workspace-video-input');
        this.fileButton = root.querySelector('#workspace-file-button');
        this.picker = new WorkspaceUploadSheet(root, kind => this.openKind(kind));
        this.feedback = root.querySelector('#workspace-attachment-feedback');
        this.status = root.querySelector('#workspace-attachment-status');
        this.retry = root.querySelector('#workspace-attachment-retry');
        this.clear = root.querySelector('#workspace-attachment-clear');
        this.pendingFiles = [];
        this.pickerRecipientId = null;
        this.useDocumentPicker = typeof window.showOpenFilePicker === 'function';
        this.bind();
    }

    bind() {
        this.fileButton.addEventListener('click', () => {
            if (!this.canSend()) return;
            if (window.matchMedia('(max-width: 780px)').matches) {
                this.picker.open();
            } else {
                this.pickerRecipientId = this.recipientId();
                this.openFiles();
            }
        });
        for (const input of [
            this.fileInput, this.imageInput, this.cameraInput, this.videoInput
        ]) {
            input.addEventListener('change', () => this.onNativeFiles(input));
        }
        this.retry.addEventListener('click', () => this.sendPending());
        this.clear.addEventListener('click', () => this.clearDraft());
    }

    openKind(kind) {
        if (!this.canSend()) return;
        this.pickerRecipientId = this.recipientId();

        switch (kind) {
            case 'camera':
                this.cameraInput.click();
                break;
            case 'video':
                this.videoInput.click();
                break;
            case 'gallery':
                this.imageInput.click();
                break;
            case 'files':
                this.openFiles();
                break;
        }
    }

    async openFiles() {
        if (!this.canSend()) return;
        this.pickerRecipientId = this.recipientId();

        if (!this.useDocumentPicker) {
            this.fileInput.click();
            return;
        }

        try {
            const handles = await window.showOpenFilePicker({
                id: 'relay-documents',
                startIn: 'documents',
                multiple: true
            });
            const files = await Promise.all(handles.map(handle => handle.getFile()));
            this.onChosen(files);
        } catch (error) {
            if (error.name === 'AbortError') return;
            // On unsupported browsers fall back on the *next user click*.
            // Trying to open another picker asynchronously may be blocked.
            this.useDocumentPicker = false;
            this.showStatus('系统文件选择器不可用，请再次选择「选择文件」');
            console.warn('File picker fallback enabled:', error);
        }
    }

    onNativeFiles(input) {
        const files = [...input.files];
        input.value = '';
        this.onChosen(files);
    }

    onChosen(files) {
        if (!files.length) return;

        if (this.canSend() && this.recipientId() === this.pickerRecipientId) {
            this.clearDraft();
            this.sendFiles(files);
            return;
        }

        // Never send to a changed recipient automatically after a picker
        // returned from the background. Explicit retry is required.
        this.pendingFiles = files;
        this.refresh();
    }

    sendPending() {
        if (!this.pendingFiles.length || !this.canSend()) return;
        const files = [...this.pendingFiles];
        this.clearDraft();
        this.sendFiles(files);
    }

    clearDraft() {
        this.pendingFiles = [];
        this.refresh();
    }

    showStatus(message) {
        this.feedback.hidden = false;
        this.status.textContent = message;
        this.retry.hidden = true;
        this.clear.hidden = true;
    }

    refresh() {
        const online = this.canSend();
        this.fileButton.disabled = !online;
        if (!online && !this.picker.panel.hidden) this.picker.close(false);

        const count = this.pendingFiles.length;
        this.feedback.hidden = count === 0;
        this.status.textContent = count
            ? (online
                ? `已选择 ${count} 个文件，确认接收设备后点击发送`
                : `已暂存 ${count} 个文件，等待设备重新连接`)
            : '';
        this.retry.hidden = count === 0 || !online;
        this.clear.hidden = count === 0;
    }
}

class WorkspaceComposer {
    constructor(root, canSend, recipientId) {
        this.root = root;
        this.canSend = canSend;
        this.recipientId = recipientId;
        this.editor = root.querySelector('#workspace-message');
        this.sendButton = root.querySelector('#workspace-send-button');
        this.dropZone = root.querySelector('.workspace-conversation');
        this.attachments = new WorkspaceAttachments(
            root,
            () => this.canSend(),
            () => this.recipientId(),
            files => this.sendFiles(files)
        );
        this.bindInputs();
    }

    bindInputs() {
        this.sendButton.addEventListener('click', () => this.sendDraft());
        this.editor.addEventListener('input', () => this.refresh());

        this.editor.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey &&
                !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                this.sendDraft();
            }
            event.stopPropagation();
        });

        // PairDrop listens for global paste-to-share. Pasting into an editor
        // must be a normal text-editing operation, not a share-mode trigger.
        this.editor.addEventListener('paste', event => event.stopPropagation());

        this.dropZone.addEventListener('dragover', event => {
            if (!this.canSend()) return;
            event.preventDefault();
            event.stopPropagation();
            this.dropZone.classList.add('is-dragging');
        });

        this.dropZone.addEventListener('dragleave', event => {
            if (!this.dropZone.contains(event.relatedTarget)) {
                this.dropZone.classList.remove('is-dragging');
            }
        });

        this.dropZone.addEventListener('drop', event => {
            if (!this.canSend()) return;
            event.preventDefault();
            event.stopPropagation();
            this.dropZone.classList.remove('is-dragging');

            const files = [...event.dataTransfer.files];
            if (files.length) {
                this.sendFiles(files);
            } else {
                const text = event.dataTransfer.getData('text/plain');
                if (text.trim()) this.sendText(text);
            }
        });
    }

    focus() {
        this.editor.focus();
    }

    refresh() {
        const enabled = this.canSend();
        this.editor.disabled = !enabled;
        this.attachments.refresh();
        this.sendButton.disabled = !enabled || !this.editor.value.trim();
        this.editor.placeholder = enabled
            ? '写点什么，按 Enter 发送…'
            : '等待你选择一台在线设备…';
    }

    sendDraft() {
        const text = this.editor.value.trim();
        if (!text || !this.canSend()) return;
        this.sendText(text);
        this.editor.value = '';
        this.refresh();
    }

    sendText(text) {
        this.emit('send-text', {text, to: this.recipientId()});
    }

    sendFiles(files) {
        if (!files.length || !this.canSend()) return;
        this.emit('files-selected', {files, to: this.recipientId()});
    }

    emit(type, detail) {
        // Reuse the same event contract as PeerUI and PeersManager.
        window.dispatchEvent(new CustomEvent(type, {detail}));
    }
}


/**
 * Download link lifecycle for already received files.
 * The transfer protocol is not touched. This class only reuses Blob objects
 * emitted by PairDrop's 'files-received' event while the page stays open.
 */
class WorkspaceDownloads {
    static maxRetainedBytes = 256 * 1024 * 1024;

    trimHistory(byPeer) {
        const received = [...byPeer.values()]
            .flat()
            .filter(entry => entry.files?.length)
            .sort((a, b) => a.sequence - b.sequence);

        let retained = received.reduce(
            (sum, entry) => sum + entry.files.reduce((n, file) => n + file.size, 0),
            0
        );

        // Evict the oldest file *references*, not the message cards.
        for (const entry of received) {
            if (retained <= WorkspaceDownloads.maxRetainedBytes) break;
            retained -= entry.files.reduce((n, file) => n + file.size, 0);
            entry.files = null;
        }
    }

    saveAgain(files) {
        for (const file of files) {
            const url = URL.createObjectURL(file);
            const link = document.createElement('a');
            link.href = url;
            link.download = file.name || 'received-file';
            link.hidden = true;
            document.body.append(link);
            link.click();
            link.remove();

            // Delayed revoke allows slow browsers to finish handling the
            // download gesture. No object URL is stored between clicks.
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
    }
}

class WorkspaceSessionLog {
    constructor(root) {
        this.root = root;
        this.list = root.querySelector('#workspace-activity');
        this.empty = root.querySelector('#workspace-empty-activity');
        this.byPeer = new Map();
        this.currentId = null;
        this.downloads = new WorkspaceDownloads();
        this.nextSequence = 0;
    }

    select(peerId) {
        this.currentId = peerId;
        this.render();
    }

    add(peerId, direction, kind, value, receivedFiles = null) {
        if (!peerId || !value) return;
        const history = this.byPeer.get(peerId) || [];
        const entry = {
            direction, kind, value, time: new Date(),
            sequence: this.nextSequence++
        };

        if (direction === 'incoming' && kind === 'files' && receivedFiles) {
            entry.files = [...receivedFiles];
        }

        history.push(entry);
        this.byPeer.set(peerId, history.slice(-30));
        this.downloads.trimHistory(this.byPeer);

        if (peerId === this.currentId) this.render();
    }

    render() {
        const history = this.byPeer.get(this.currentId) || [];
        this.list.replaceChildren();
        this.empty.hidden = history.length > 0;
        if (!history.length) return;

        const fragment = document.createDocumentFragment();
        history.forEach(entry => fragment.append(this.renderEntry(entry)));
        this.list.append(fragment);
        this.list.scrollTop = this.list.scrollHeight;
    }

    renderEntry(entry) {
        const item = document.createElement('div');
        item.className = 'workspace-activity-item ' + entry.direction;

        const message = document.createElement('div');
        message.className = 'workspace-activity-message';
        // Safe even if a peer sends HTML-like text.
        message.textContent = entry.value;

        const meta = document.createElement('div');
        meta.className = 'workspace-activity-meta';
        meta.textContent =
            (entry.direction === 'incoming' ? '已接收' : '已发起发送') +
            ' · ' + (entry.kind === 'files' ? '文件' : '文字') +
            ' · ' + entry.time.toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit'
            });

        item.append(message, meta);

        // The old receive-text modal provided copying. Keep that convenience
        // inside the conversation, without recreating a blocking dialog.
        if (entry.kind === 'text' && navigator.clipboard?.writeText) {
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'workspace-copy-button';
            copy.textContent = '复制';
            copy.setAttribute('aria-label', '复制这条文字消息');
            copy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(entry.value);
                    copy.textContent = '已复制';
                } catch (error) {
                    copy.textContent = '复制失败';
                    console.warn('Could not copy message', error);
                }
            });
            item.append(copy);
        }

        if (entry.kind === 'files' && entry.direction === 'incoming' &&
            entry.files?.length) {
            const download = document.createElement('button');
            download.type = 'button';
            download.className = 'workspace-download-button';
            download.textContent = '↓';
            download.title = '再次保存';
            download.setAttribute('aria-label', '再次保存收到的文件');
            download.addEventListener('click', () => {
                try {
                    this.downloads.saveAgain(entry.files);
                } catch (error) {
                    console.warn('Could not start another download', error);
                    download.title = '下载启动失败，请重试';
                }
            });
            item.append(download);
        }

        return item;
    }
}

class PersonalWorkspace {
    constructor(root) {
        this.root = root;
        this.devices = new WorkspaceDevices(
            root.querySelector('x-peers'),
            userInitiated => this.refresh(userInitiated)
        );
        this.composer = new WorkspaceComposer(
            root,
            () => this.canSend(),
            () => this.devices.selectedId
        );
        this.activity = new WorkspaceSessionLog(root);

        this.bindActions();
        this.bindEvents();
        this.refresh();

        // Received text is routed by the presence of this workspace shell.
        // No late mutable flag is needed to select between chat and modal.
    }

    canSend() {
        return !!this.devices.current() && !this.devices.shareModeActive;
    }

    bindActions() {
        this.root.querySelector('#workspace-pair-button')
            .addEventListener('click', () => document.getElementById('pair-device').click());
        this.root.querySelector('#workspace-room-button')
            .addEventListener('click', () => document.getElementById('join-public-room').click());
    }

    bindEvents() {
        window.addEventListener('peer-added', () => this.devices.onPeerAdded());
        window.addEventListener('peer-disconnected', event => {
            // Let upstream PeerUI finish removing its x-peer element first.
            queueMicrotask(() => this.devices.onPeerDisconnected(event.detail));
        });
        window.addEventListener('peer-display-name-changed', () => this.refresh());
        window.addEventListener('room-type-removed', () => this.devices.refresh());

        window.addEventListener('share-mode-changed', event => {
            this.devices.setShareMode(!!event.detail.active);
            this.composer.refresh();
        });

        window.addEventListener('ws-connected', () => this.showConnection(true));
        window.addEventListener('ws-disconnected', () => this.showConnection(false));

        // Session log is a non-authoritative display, never persisted.
        window.addEventListener('send-text', event => {
            this.activity.add(event.detail.to, 'outgoing', 'text', event.detail.text);
        });
        window.addEventListener('files-selected', event => {
            const filenames = [...event.detail.files].map(file => file.name).join(' · ');
            this.activity.add(event.detail.to, 'outgoing', 'files', filenames);
        });
        window.addEventListener('text-received', event => {
            this.activity.add(event.detail.peerId, 'incoming', 'text', event.detail.text);
            this.devices.markIncoming(event.detail.peerId);
        });
        window.addEventListener('files-received', event => {
            const files = [...event.detail.files];
            const filenames = files.map(file => file.name).join(' · ');
            this.activity.add(event.detail.peerId, 'incoming', 'files', filenames, files);
        });
    }

    showConnection(online) {
        const status = this.root.querySelector('#workspace-connection');
        status.textContent = online ? '信令已连接' : '正在连接…';
        status.classList.toggle('is-online', online);
    }

    refresh(focusComposer = false) {
        const peers = this.devices.getPeers();
        const selected = this.devices.current();

        this.root.querySelector('#workspace-device-count').textContent =
            String(peers.length);
        this.root.classList.toggle('workspace-has-selection', !!selected);

        this.root.querySelector('#workspace-recipient').textContent =
            selected?.querySelector('.name')?.textContent || '还没有选择设备';
        this.root.querySelector('#workspace-recipient-detail').textContent =
            selected?.querySelector('.device-name')?.textContent ||
            '选择左侧的在线设备后即可开始传输';

        this.activity.select(this.devices.selectedId);
        this.composer.refresh();

        if (focusComposer && window.matchMedia('(min-width: 780px)').matches) {
            this.composer.focus();
        }
    }
}

new PersonalWorkspace(document.getElementById('personal-workspace'));
