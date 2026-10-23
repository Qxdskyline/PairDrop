/**
 * Personal Workspace
 *
 * Presentation adapter for the upstream PairDrop event contract.
 * Owns only local device selection, compose controls and ephemeral activity.
 * Network, pairing, transfer permissions and download handling stay upstream.
 */
class PersonalWorkspace {
    constructor(root) {
        this.root = root;
        this.devices = root.querySelector('x-peers');
        this.editor = root.querySelector('#workspace-message');
        this.fileInput = root.querySelector('#workspace-file-input');
        this.fileButton = root.querySelector('#workspace-file-button');
        this.sendButton = root.querySelector('#workspace-send-button');
        this.dropZone = root.querySelector('.workspace-conversation');
        this.activityList = root.querySelector('#workspace-activity');
        this.selectedPeerId = null;
        this.shareModeActive = false;
        this.activities = new Map();

        this.devices.setAttribute('role', 'listbox');
        this.devices.setAttribute('aria-label', '在线设备');

        this.bindControls();
        this.bindPairDropEvents();
        this.render();
    }

    bindControls() {
        // PairDrop's device label normally opens a file picker. In the workspace,
        // a normal click selects the device; the explicit attachment button sends.
        this.devices.addEventListener('click', event => {
            if (this.shareModeActive) return;

            const peer = event.target.closest('x-peer');
            if (!peer || peer.hasAttribute('status')) return;

            event.preventDefault();
            this.selectPeer(peer.id);
        }, true);

        this.devices.addEventListener('keydown', event => {
            const peer = event.target.closest('x-peer');
            if (peer !== event.target || this.shareModeActive) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;

            event.preventDefault();
            this.selectPeer(peer.id);
        });

        this.fileButton.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', () => {
            if (this.fileInput.files.length) {
                this.sendFiles([...this.fileInput.files]);
            }
            this.fileInput.value = '';
        });

        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.editor.addEventListener('input', () => this.updateComposer());

        this.editor.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                this.sendMessage();
            }
            event.stopPropagation();
        });

        // Prevent upstream's global paste-to-share shortcut while composing.
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

        root.querySelector('#workspace-pair-button')
            .addEventListener('click', () => document.getElementById('pair-device').click());
        root.querySelector('#workspace-room-button')
            .addEventListener('click', () => document.getElementById('join-public-room').click());
    }

    bindPairDropEvents() {
        window.addEventListener('peer-added', () => {
            const peers = this.getPeers();
            if (!this.selectedPeerId && peers.length === 1) {
                this.selectedPeerId = peers[0].id;
            }
            this.render();
        });

        window.addEventListener('peer-disconnected', event => {
            if (this.selectedPeerId === event.detail) this.selectedPeerId = null;
            queueMicrotask(() => this.render());
        });

        window.addEventListener('peer-display-name-changed', () => this.render());
        window.addEventListener('room-type-removed', () => this.render());

        window.addEventListener('share-mode-changed', event => {
            this.shareModeActive = !!event.detail.active;
            this.updateComposer();
        });

        window.addEventListener('ws-connected', () => this.renderConnection(true));
        window.addEventListener('ws-disconnected', () => this.renderConnection(false));

        // Activity is session-only. It is never stored or uploaded by this adapter.
        window.addEventListener('send-text', event => {
            this.record(event.detail.to, 'outgoing', 'text', event.detail.text);
        });
        window.addEventListener('files-selected', event => {
            const files = [...event.detail.files];
            this.record(event.detail.to, 'outgoing', 'files',
                files.map(file => file.name).join(' · '));
        });
        window.addEventListener('text-received', event => {
            this.record(event.detail.peerId, 'incoming', 'text', event.detail.text);
        });
        window.addEventListener('files-received', event => {
            this.record(event.detail.peerId, 'incoming', 'files',
                event.detail.files.map(file => file.name).join(' · '));
        });
    }

    getPeers() {
        return [...this.devices.querySelectorAll('x-peer')];
    }

    getSelectedPeer() {
        return this.getPeers().find(peer => peer.id === this.selectedPeerId);
    }

    canSend() {
        return !!this.getSelectedPeer() && !this.shareModeActive;
    }

    selectPeer(peerId) {
        if (!this.getPeers().some(peer => peer.id === peerId)) return;
        this.selectedPeerId = peerId;
        this.render();
        if (window.matchMedia('(min-width: 780px)').matches) this.editor.focus();
    }

    sendMessage() {
        const text = this.editor.value.trim();
        if (!text || !this.canSend()) return;
        this.sendText(text);
        this.editor.value = '';
        this.updateComposer();
    }

    sendText(text) {
        window.dispatchEvent(new CustomEvent('send-text', {
            detail: { text, to: this.selectedPeerId }
        }));
    }

    sendFiles(files) {
        if (!files.length || !this.canSend()) return;
        window.dispatchEvent(new CustomEvent('files-selected', {
            detail: { files, to: this.selectedPeerId }
        }));
    }

    record(peerId, direction, kind, value) {
        if (!peerId || !value) return;

        const history = this.activities.get(peerId) || [];
        history.push({ direction, kind, value, time: new Date() });
        this.activities.set(peerId, history.slice(-30));

        if (this.selectedPeerId === peerId) this.renderActivity();
    }

    render() {
        const peers = this.getPeers();
        const current = this.getSelectedPeer();

        this.root.querySelector('#workspace-device-count').textContent =
            String(peers.length);

        peers.forEach(peer => {
            const isSelected = peer.id === this.selectedPeerId;
            peer.classList.toggle('workspace-selected', isSelected);
            peer.setAttribute('role', 'option');
            peer.tabIndex = 0;
            peer.setAttribute('aria-selected', String(isSelected));
            if (!this.shareModeActive) {
                peer.querySelector('label').title = '选择设备。发送文件请使用右侧文件按钮。';
            }
        });

        this.root.classList.toggle('workspace-has-selection', !!current);
        this.root.querySelector('#workspace-recipient').textContent =
            current?.querySelector('.name')?.textContent || '还没有选择设备';
        this.root.querySelector('#workspace-recipient-detail').textContent =
            current?.querySelector('.device-name')?.textContent ||
            '选择左侧的在线设备后即可开始传输';

        this.updateComposer();
        this.renderActivity();
    }

    updateComposer() {
        const enabled = this.canSend();
        this.editor.disabled = !enabled;
        this.fileButton.disabled = !enabled;
        this.sendButton.disabled = !enabled || !this.editor.value.trim();
        this.editor.placeholder = enabled
            ? '写点什么，按 Enter 发送…'
            : '等待你选择一台在线设备…';
    }

    renderConnection(connected) {
        const status = this.root.querySelector('#workspace-connection');
        status.textContent = connected ? '信令已连接' : '正在连接…';
        status.classList.toggle('is-online', connected);
    }

    renderActivity() {
        const history = this.activities.get(this.selectedPeerId) || [];
        this.activityList.replaceChildren();

        this.root.querySelector('#workspace-empty-activity').hidden = history.length > 0;
        if (!history.length) return;

        const fragment = document.createDocumentFragment();

        history.forEach(activity => {
            const item = document.createElement('div');
            item.className = 'workspace-activity-item ' + activity.direction;

            const message = document.createElement('div');
            message.className = 'workspace-activity-message';
            message.textContent = activity.value;

            const meta = document.createElement('div');
            meta.className = 'workspace-activity-meta';
            meta.textContent =
                (activity.direction === 'incoming' ? '已接收' : '已发起发送') +
                ' · ' + (activity.kind === 'files' ? '文件' : '文字') +
                ' · ' + activity.time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

            item.append(message, meta);
            fragment.append(item);
        });

        this.activityList.append(fragment);
        this.activityList.scrollTop = this.activityList.scrollHeight;
    }
}

new PersonalWorkspace(document.getElementById('personal-workspace'));
