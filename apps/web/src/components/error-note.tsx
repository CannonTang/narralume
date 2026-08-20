import { apiErrorHint, apiErrorMessage } from "../lib/api";

/* 错误注记：ApiError 的错误码提示优先，回退到后端 message。 */

interface ErrorNoteProps {
  error: unknown;
  title?: string;
}

export function ErrorNote({ error, title }: ErrorNoteProps) {
  const hint = apiErrorHint(error);
  const message = apiErrorMessage(error);
  return (
    <div className="error-note" role="alert">
      <p className="error-note__title">{title ?? "出了点问题"}</p>
      <p className="error-note__message">{message}</p>
      {hint && hint !== message ? (
        <p className="error-note__hint">{hint}</p>
      ) : null}
    </div>
  );
}
