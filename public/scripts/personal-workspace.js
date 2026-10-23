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

        this.root.setAttribute('role', 'listbox');
        this.root.setAttribute('aria-label', '在线设备');
        this.bindSelection();
    }

    getPeers() {
        return [...this.root.querySelectorAll('x-peer')];
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
        this.refresh();
        this.onSelectionChanged(userInitiated);
    }

    onPeerAdded() {
        const peers = this.getPeers();
        if (!this.selectedId && peers.length === 1) {
            this.selectedId = peers[0].id;
        }
        this.refresh();
        this.onSelectionChanged(false);
    }

    onPeerDisconnected(peerId) {
        if (this.selectedId === peerId) this.selectedId = null;
        this.refresh();
        this.onSelectionChanged(false);
    }

    setShareMode(active) {
        this.shareModeActive = active;
        this.refresh();
    }

    refresh() {
        this.getPeers().forEach(peer => {
            const selected = peer.id === this.selectedId;
            peer.classList.toggle('workspace-selected', selected);
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

class WorkspaceComposer {
    constructor(root, canSend, recipientId) {
        this.root = root;
        this.canSend = canSend;
        this.recipientId = recipientId;
        this.editor = root.querySelector('#workspace-message');
        this.fileInput = root.querySelector('#workspace-file-input');
        this.fileButton = root.querySelector('#workspace-file-button');
        this.sendButton = root.querySelector('#workspace-send-button');
        this.dropZone = root.querySelector('.workspace-conversation');
        this.bindInputs();
    }

    bindInputs() {
        this.fileButton.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', () => {
            if (this.fileInput.files.length) {
                this.sendFiles([...this.fileInput.files]);
            }
            this.fileInput.value = '';
        });

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
        this.fileButton.disabled = !enabled;
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

class WorkspaceSessionLog {
    constructor(root) {
        this.root = root;
        this.list = root.querySelector('#workspace-activity');
        this.empty = root.querySelector('#workspace-empty-activity');
        this.byPeer = new Map();
        this.currentId = null;
    }

    select(peerId) {
        this.currentId = peerId;
        this.render();
    }

    add(peerId, direction, kind, value) {
        if (!peerId || !value) return;
        const history = this.byPeer.get(peerId) || [];

        history.push({direction, kind, value, time: new Date()});
        this.byPeer.set(peerId, history.slice(-30));

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
        });
        window.addEventListener('files-received', event => {
            const filenames = event.detail.files.map(file => file.name).join(' · ');
            this.activity.add(event.detail.peerId, 'incoming', 'files', filenames);
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
