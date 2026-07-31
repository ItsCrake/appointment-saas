"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { useToast } from "@/components/ui/toast";

import {
  removeServiceAction,
  saveServiceAction,
  toggleServiceAction,
} from "@/app/dashboard/services/actions";
import { formatDuration, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type Service = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  sortOrder: number;
  isActive: boolean;
  currency: string;
  bufferMin: number | null;
};

type Draft = {
  name: string;
  description: string;
  durationMin: string;
  price: string;
  bufferMin: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY: Draft = {
  name: "",
  description: "",
  durationMin: "30",
  price: "70",
  bufferMin: "",
  sortOrder: "0",
  isActive: true,
};

function toDraft(service: Service): Draft {
  return {
    name: service.name,
    description: service.description ?? "",
    durationMin: String(service.durationMin),
    // Prices are stored in agorot; the form works in shekels.
    price: String(service.priceCents / 100),
    // Empty string means "inherit the business default".
    bufferMin: service.bufferMin === null ? "" : String(service.bufferMin),
    sortOrder: String(service.sortOrder),
    isActive: service.isActive,
  };
}

export function ServicesManager({ services }: { services: Service[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function startCreate() {
    setDraft(EMPTY);
    setCreating(true);
    setEditingId(null);
    setError(undefined);
  }

  function startEdit(service: Service) {
    setDraft(toDraft(service));
    setEditingId(service.id);
    setCreating(false);
    setError(undefined);
  }

  function close() {
    setCreating(false);
    setEditingId(null);
    setError(undefined);
  }

  function save() {
    setError(undefined);
    setNotice(undefined);

    const payload = {
      name: draft.name,
      description: draft.description,
      durationMin: Number(draft.durationMin),
      priceCents: Math.round(Number(draft.price) * 100),
      // Blank inherits the business buffer; 0 is a deliberate "no gap".
      bufferMin: draft.bufferMin.trim() === "" ? null : Number(draft.bufferMin),
      sortOrder: Number(draft.sortOrder) || 0,
      isActive: draft.isActive,
    };

    if (
      !Number.isFinite(payload.durationMin) ||
      !Number.isFinite(payload.priceCents)
    ) {
      setError("משך ומחיר חייבים להיות מספרים");
      return;
    }

    const isEdit = editingId !== null;

    startTransition(async () => {
      const result = await saveServiceAction(payload, editingId ?? undefined);
      if (result.ok) {
        toast(isEdit ? "השירות עודכן בהצלחה" : "השירות נוסף");
        close();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function toggle(service: Service) {
    setNotice(undefined);
    startTransition(async () => {
      const result = await toggleServiceAction(service.id, !service.isActive);
      if (result.ok) {
        toast(service.isActive ? "השירות הוסתר" : "השירות מוצג שוב");
        router.refresh();
      } else {
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  function remove(service: Service) {
    setNotice(undefined);
    startTransition(async () => {
      const result = await removeServiceAction(service.id);
      if (result.ok) {
        setNotice(result.message);
        toast(result.message ?? "השירות נמחק");
        router.refresh();
      } else {
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  const formOpen = creating || editingId !== null;

  return (
    <div>
      {notice ? (
        <p
          role="status"
          className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {notice}
        </p>
      ) : null}

      {error && !formOpen ? (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {!formOpen ? (
        <button
          type="button"
          onClick={startCreate}
          className="mb-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900"
        >
          <Plus className="size-4" aria-hidden />
          שירות חדש
        </button>
      ) : (
        <div className="mb-4 rounded-2xl border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
              {editingId ? "עריכת שירות" : "שירות חדש"}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="סגירה"
              className="rounded-lg p-1 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-3">
            <Input
              label="שם השירות"
              value={draft.name}
              onChange={(v) => setDraft({ ...draft, name: v })}
            />
            <Input
              label="תיאור (לא חובה)"
              value={draft.description}
              onChange={(v) => setDraft({ ...draft, description: v })}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input
                label="דקות"
                type="number"
                value={draft.durationMin}
                onChange={(v) => setDraft({ ...draft, durationMin: v })}
              />
              <Input
                label="מחיר ₪"
                type="number"
                value={draft.price}
                onChange={(v) => setDraft({ ...draft, price: v })}
              />
              <Input
                label="מרווח"
                type="number"
                value={draft.bufferMin}
                placeholder="ברירת מחדל"
                onChange={(v) => setDraft({ ...draft, bufferMin: v })}
              />
              <Input
                label="סדר"
                type="number"
                value={draft.sortOrder}
                onChange={(v) => setDraft({ ...draft, sortOrder: v })}
              />
            </div>
            <p className="text-xs text-neutral-400">
              מרווח ריק = שימוש בברירת המחדל של העסק. 0 = ללא מרווח.
            </p>

            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft({ ...draft, isActive: e.target.checked })
                }
                className="size-4 rounded border-neutral-300"
              />
              מוצג בעמוד ההזמנות
            </label>

            {error ? (
              <p role="alert" className="text-xs font-medium text-red-600">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              שמירה
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-3">
        {services.map((service) => (
          <li
            key={service.id}
            className={cn(
              "rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900",
              !service.isActive && "opacity-60",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {service.name}
                </p>
                {service.description ? (
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {service.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-neutral-500">
                  {formatDuration(service.durationMin)} ·{" "}
                  {formatPrice(service.priceCents, service.currency)}
                  {!service.isActive ? " · מוסתר" : ""}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <IconButton
                  label={service.isActive ? "הסתרה" : "הצגה"}
                  onClick={() => toggle(service)}
                  disabled={pending}
                >
                  {service.isActive ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                </IconButton>
                <IconButton
                  label="עריכה"
                  onClick={() => startEdit(service)}
                  disabled={pending}
                >
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  label="מחיקה"
                  onClick={() => remove(service)}
                  disabled={pending}
                  danger
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {services.length === 0 && !formOpen ? (
        <p className="rounded-2xl border border-dashed border-neutral-200 px-4 py-12 text-center text-sm text-neutral-500 dark:border-neutral-800">
          עדיין אין שירותים. הוסיפו את הראשון.
        </p>
      ) : null}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      />
    </label>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-lg border border-neutral-200 p-2 text-neutral-500 transition-colors disabled:opacity-50 dark:border-neutral-700",
        danger
          ? "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
          : "hover:bg-neutral-50 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
      )}
    >
      {children}
    </button>
  );
}
