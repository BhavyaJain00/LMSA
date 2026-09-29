"use client";

import { startTransition, type FormEvent } from "react";

/**
 * `onSubmit` handler that dispatches a `useActionState` action WITHOUT
 * React 19's automatic form reset.
 *
 * With `<form action={fn}>`, React resets every uncontrolled field
 * (`defaultValue` / `defaultChecked`) once the action finishes, even when it
 * returns validation errors, so the user loses what they typed. Dispatching
 * from `onSubmit` inside a transition keeps the pending state of
 * `useActionState` but leaves the fields as the user left them.
 */
export function submitWithoutReset(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    let data: FormData;
    try {
      data = new FormData(form, submitter);
    } catch {
      data = new FormData(form);
    }
    startTransition(() => dispatch(data));
  };
}
