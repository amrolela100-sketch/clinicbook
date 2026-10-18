'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Sparkles,
  X,
  Send,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  PhoneCall,
  User,
  ShieldAlert,
} from 'lucide-react';
import type { AgentDoctorCard } from '@/lib/services/agent-service';

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  time: string;
  emergency?: boolean;
  doctors?: AgentDoctorCard[];
  suggestedActions?: string[];
  bookingSuccess?: boolean;
}

export function AgentChatDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: 'مرحباً بك في المساعد الطبي الذكي لمنصة ClinicBook 🩺.\nأنا هنا لمساعدتك في استكشاف الأطباء، فرز الأعراض، وتأكيد حجزك الذري بدون تعارض.',
      time: 'الآن',
      suggestedActions: [
        'عندي ألم في الأسنان',
        'أريد حجز موعد مع طبيب قلب',
        'مواعيد أطباء الأطفال اليوم',
      ],
    },
  ]);

  const [bookingModal, setBookingModal] = useState<{
    open: boolean;
    doctorId: string;
    doctorName: string;
    start: string;
    fee: number;
  } | null>(null);

  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // التمرير التلقائي لأسفل المحادثة
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // إغلاق الدرج عند الضغط على Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // التركيز على حقل الإدخال عند الفتح
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputMessage).trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', message: text }),
      });

      const json = await res.json();
      if (json.success && json.data) {
        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          sender: 'agent',
          text: json.data.reply,
          time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
          emergency: json.data.emergency,
          doctors: json.data.doctors,
          suggestedActions: json.data.suggestedActions,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            sender: 'agent',
            text: json.error || 'عذراً، حدث خطأ أثناء معالجة طلبك.',
            time: 'الآن',
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'agent',
          text: 'تعذر الاتصال بخادم المساعد الذكي. يرجى التحقق من اتصالك بالإنترنت.',
          time: 'الآن',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmSlotBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingModal || !patientName.trim() || !patientPhone.trim() || bookingLoading) return;

    setBookingLoading(true);
    setBookingError(null);
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'book_slot',
          doctorId: bookingModal.doctorId,
          start: bookingModal.start,
          patientName: patientName.trim(),
          phone: patientPhone.trim(),
          visitType: 'first_visit',
        }),
      });

      const json = await res.json();
      if (json.success) {
        const timeFormatted = new Date(bookingModal.start).toLocaleTimeString('ar-SA', {
          hour: '2-digit',
          minute: '2-digit',
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `booking-success-${Date.now()}`,
            sender: 'agent',
            text: `✅ تم تأكيد حجزك الذري بنجاح!\n• المريض: ${patientName.trim()}\n• الطبيب: د. ${bookingModal.doctorName}\n• الوقت: ${timeFormatted}\n• الكشفية: ${bookingModal.fee} ل.س\n\nتم حفظ الموعد في سجل العيادة وسيتواصل معك منسق الرعاية الذكي قبل الموعد للتأكيد.`,
            time: 'الآن',
            bookingSuccess: true,
          },
        ]);
        setBookingModal(null);
        setBookingError(null);
        setPatientName('');
        setPatientPhone('');
      } else {
        setBookingError(json.data?.error || json.error || 'تعذر إتمام الحجز. يرجى المحاولة مجدداً.');
      }
    } catch {
      setBookingError('حدث خطأ في الاتصال بالخادم أثناء حجز الموعد.');
    } finally {
      setBookingLoading(false);
    }
  };

  return (
    <>
      {/* الزر العائم لفتح المساعد الذكي */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="افتح المساعد الطبي الذكي"
        aria-expanded={isOpen}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2.5 rounded-full bg-gradient-to-r from-teal-600 to-emerald-600 px-4 py-3 text-white shadow-xl shadow-teal-700/30 transition-all hover:scale-105 hover:shadow-2xl hover:shadow-teal-700/40 focus:outline-none focus:ring-4 focus:ring-teal-300"
      >
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75"></span>
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400"></span>
        </span>
        <Bot className="h-5 w-5" />
        <span className="text-sm font-semibold tracking-wide">المساعد الذكي 🩺</span>
      </button>

      {/* خلفية التعتيم (Backdrop) */}
      {isOpen && (
        <div
          role="presentation"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        />
      )}

      {/* نافذة الدرج الجانبي للمحادثة (Chat Drawer) */}
      <aside
        ref={drawerRef}
        aria-label="المساعد الطبي الذكي"
        aria-hidden={!isOpen}
        dir="rtl"
        className={`fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out dark:bg-slate-900 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* شريط رأس المحادثة */}
        <header className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-teal-700 via-teal-800 to-emerald-800 p-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur-md">
              <Bot className="h-6 w-6 text-teal-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">مساعد ClinicBook</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  <Sparkles className="h-3 w-3" />
                  ذكي ودائم
                </span>
              </div>
              <p className="text-xs text-teal-200/80">فرز الأعراض وحجز المواعيد بدون تضارب</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="إغلاق نافذة المساعد"
            className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* جسم المحادثة والرسائل */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-start' : 'items-end'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                  msg.sender === 'user'
                    ? 'rounded-br-sm bg-teal-600 text-white'
                    : msg.emergency
                      ? 'rounded-bl-sm border border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                      : msg.bookingSuccess
                        ? 'rounded-bl-sm border border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'rounded-bl-sm border border-slate-100 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-100'
                }`}
              >
                {msg.emergency && (
                  <div className="mb-2 flex items-center gap-1.5 font-bold text-rose-600 dark:text-rose-400">
                    <ShieldAlert className="h-4 w-4" />
                    <span>بروتوكول فرز الطوارئ</span>
                  </div>
                )}
                <div className="whitespace-pre-wrap">{msg.text}</div>
                <div
                  className={`mt-1.5 text-[10px] ${
                    msg.sender === 'user' ? 'text-teal-200' : 'text-slate-400'
                  }`}
                >
                  {msg.time}
                </div>
              </div>

              {/* بطاقات الأطباء والفترات المقترحة */}
              {msg.doctors && msg.doctors.length > 0 && (
                <div className="mt-3 w-full space-y-2.5">
                  <div className="text-xs font-semibold text-slate-500">
                    الأطباء المتاحون للحجز الفوري:
                  </div>
                  {msg.doctors.map((doc) => (
                    <div
                      key={doc.doctorId}
                      className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-right shadow-sm dark:border-teal-900/50 dark:bg-slate-800"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-slate-800 dark:text-white">
                          د. {doc.doctorName}
                        </div>
                        <span className="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                          {doc.fee} ل.س
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>{doc.specialty} • {doc.clinic}</span>
                        {doc.date && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            {doc.isFutureDate ? `أقرب موعد: ${doc.date}` : `مواعيد: ${doc.date}`}
                          </span>
                        )}
                      </div>

                      {doc.slots.length > 0 ? (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {doc.slots.slice(0, 4).map((s) => {
                            const timeStr = new Date(s.start).toLocaleTimeString('ar-SA', {
                              hour: '2-digit',
                              minute: '2-digit',
                            });
                            return (
                              <button
                                key={s.start}
                                type="button"
                                onClick={() =>
                                  setBookingModal({
                                    open: true,
                                    doctorId: doc.doctorId,
                                    doctorName: doc.doctorName,
                                    start: s.start,
                                    fee: doc.fee,
                                  })
                                }
                                className="flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2 py-1 text-xs font-medium text-teal-700 transition hover:bg-teal-600 hover:text-white dark:border-teal-800 dark:bg-slate-900 dark:text-teal-300"
                              >
                                <Clock className="h-3 w-3" />
                                <span>{timeStr}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-amber-600">
                          لا توجد فترات شاغرة اليوم
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* أزرار الإجراءات السريعة (Quick Suggestions) */}
              {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.suggestedActions.map((action, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSendMessage(action)}
                      className="rounded-full border border-teal-200 bg-teal-50/80 px-2.5 py-1 text-xs font-medium text-teal-800 transition hover:bg-teal-100 dark:border-teal-800 dark:bg-slate-800 dark:text-teal-300"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Bot className="h-4 w-4 animate-bounce text-teal-600" />
              <span>جاري التحقق واستدعاء أدوات العيادة...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* حقل الإدخال السفلي */}
        <footer className="border-t border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="اكتب استفسارك أو الأعراض التي تشعر بها..."
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="submit"
              disabled={isLoading || !inputMessage.trim()}
              aria-label="إرسال الرسالة"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white transition hover:bg-teal-700 disabled:opacity-40"
            >
              <Send className="h-4 w-4 rotate-180" />
            </button>
          </form>
        </footer>
      </aside>

      {/* نافذة التأكيد السريع للموعد من داخل المحادثة */}
      {bookingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div
            dir="rtl"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                تأكيد الموعد الذري
              </h3>
              <button
                type="button"
                onClick={() => setBookingModal(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              <div>
                <strong>الطبيب:</strong> د. {bookingModal.doctorName}
              </div>
              <div>
                <strong>الموعد:</strong>{' '}
                {new Date(bookingModal.start).toLocaleDateString('ar-SA')} -{' '}
                {new Date(bookingModal.start).toLocaleTimeString('ar-SA', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div>
                <strong>الكشفية:</strong> {bookingModal.fee} ل.س
              </div>
            </div>

            {bookingError && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
              >
                <div className="flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>تنبيه الحجز</span>
                </div>
                <p className="mt-1">{bookingError}</p>
              </div>
            )}

            <form onSubmit={handleConfirmSlotBooking} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  اسم المريض الكامل
                </label>
                <input
                  type="text"
                  required
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="مثال: يوسف الأحمد"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  رقم الهاتف للتأكيد
                </label>
                <input
                  type="tel"
                  required
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  placeholder="0912345678"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="submit"
                  disabled={bookingLoading}
                  className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                >
                  {bookingLoading ? 'جاري التأكيد...' : 'تأكيد الحجز الفوري'}
                </button>
                <button
                  type="button"
                  onClick={() => setBookingModal(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
