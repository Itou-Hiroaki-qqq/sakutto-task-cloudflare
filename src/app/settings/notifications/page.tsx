'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';

interface NotificationSettings {
    email: string | null;
    email_notification_enabled: boolean;
}

export default function NotificationSettingsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [settings, setSettings] = useState<NotificationSettings>({
        email: null,
        email_notification_enabled: false,
    });
    const [email, setEmail] = useState('');
    const [loginEmail, setLoginEmail] = useState<string | null>(null);
    const [emailEnabled, setEmailEnabled] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        const returnUrlParam = new URLSearchParams(window.location.search).get('returnUrl');
        if (returnUrlParam) {
            sessionStorage.setItem('notificationSettingsReturnUrl', returnUrlParam);
        } else {
            sessionStorage.removeItem('notificationSettingsReturnUrl');
        }
    }, []);

    const checkAuth = async () => {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { router.push('/login'); return; }
        const { user } = await res.json() as any;
        setUserId(user.id);
        setLoginEmail(user.email || null);
        loadSettings();
    };

    const loadSettings = async () => {
        try {
            const response = await fetch('/api/settings/notifications');
            if (response.ok) {
                const data = await response.json() as any;
                setSettings(data.settings);
                setEmail(data.settings.email || data.loginEmail || '');
                setEmailEnabled(data.settings.email_notification_enabled || false);
                if (data.loginEmail) setLoginEmail(data.loginEmail);
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            setMessage({ type: 'error', text: '設定の読み込みに失敗しました' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!userId) return;

        if (emailEnabled && !email) {
            setMessage({ type: 'error', text: 'メール通知を有効にするには、メールアドレスを入力してください' });
            return;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setMessage({ type: 'error', text: '有効なメールアドレスを入力してください' });
            return;
        }

        setSaving(true);
        setMessage(null);

        try {
            const response = await fetch('/api/settings/notifications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailEnabled ? email : null, email_notification_enabled: emailEnabled }),
            });

            if (response.ok) {
                setMessage({ type: 'success', text: '設定を保存しました' });
                loadSettings();

                const returnUrl = sessionStorage.getItem('notificationSettingsReturnUrl');
                if (returnUrl) {
                    sessionStorage.removeItem('notificationSettingsReturnUrl');
                    setTimeout(() => router.push(returnUrl), 1000);
                    return;
                }
            } else {
                const data = await response.json() as any;
                setMessage({ type: 'error', text: data.error || '設定の保存に失敗しました' });
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            setMessage({ type: 'error', text: '設定の保存に失敗しました' });
        } finally {
            setSaving(false);
        }
    };

    if (loading || !userId) {
        return (
            <Layout>
                <div className="flex items-center justify-center min-h-screen">
                    <span className="loading loading-spinner loading-lg"></span>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="container mx-auto px-4 py-6 max-w-2xl">
                <h1 className="text-3xl font-bold mb-6">通知送受信設定</h1>

                {message && (
                    <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'} mb-6`}>
                        <span>{message.text}</span>
                    </div>
                )}

                <div className="card bg-base-100 shadow-xl mb-6">
                    <div className="card-body">
                        <h2 className="card-title text-xl mb-4">メール通知設定</h2>

                        <div className="form-control mb-4">
                            <label className="label cursor-pointer">
                                <span className="label-text">メール通知を有効にする</span>
                                <input
                                    type="checkbox"
                                    className="toggle toggle-primary"
                                    checked={emailEnabled}
                                    onChange={(e) => setEmailEnabled(e.target.checked)}
                                />
                            </label>
                        </div>

                        {emailEnabled && (
                            <div className="form-control mb-4">
                                <label className="label">
                                    <span className="label-text">通知用メールアドレス</span>
                                </label>
                                <input
                                    type="email"
                                    placeholder="example@example.com"
                                    className="input input-bordered w-full"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                                <p className="text-sm text-base-content/70">
                                    タスクの期日・通知時刻にメール通知が送信されます
                                </p>
                                <p className="text-sm text-base-content/60">
                                    ログインアドレスでよい場合はこのまま保存、違うアドレスを使用する場合は変更して保存してください
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-end gap-4">
                    <button className="btn btn-ghost" onClick={() => router.back()}>キャンセル</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? (
                            <><span className="loading loading-spinner loading-sm"></span>保存中...</>
                        ) : '保存'}
                    </button>
                </div>
            </div>
        </Layout>
    );
}
