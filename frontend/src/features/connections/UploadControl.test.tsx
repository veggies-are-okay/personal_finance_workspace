import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { renderWithProviders } from '../../test/renderWithProviders';
import { UploadControl } from './UploadControl';

function fileInputFor(name: RegExp): HTMLInputElement {
  // The visible label "Choose file(s)" is associated with the hidden file input.
  return screen.getByLabelText(name) as HTMLInputElement;
}

describe('UploadControl', () => {
  it('renders a labelled file picker with the source-appropriate accept + multiple', () => {
    renderWithProviders(<UploadControl source="transactions" />);
    const input = fileInputFor(/choose files/i);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.csv,.pdf');
    expect(input).toHaveAttribute('multiple');

    // The upload action is disabled until a file is selected.
    expect(screen.getByRole('button', { name: /upload & ingest/i })).toBeDisabled();
  });

  it('uses a single-file picker without multiple for holdings (.csv only)', () => {
    renderWithProviders(<UploadControl source="holdings" />);
    const input = fileInputFor(/choose file$/i);
    expect(input).toHaveAttribute('accept', '.csv');
    expect(input).not.toHaveAttribute('multiple');
  });

  it('uses .yaml,.yml for accounts', () => {
    renderWithProviders(<UploadControl source="accounts" />);
    expect(fileInputFor(/choose file$/i)).toHaveAttribute('accept', '.yaml,.yml');
  });

  it('fires a multipart POST to /ingest/{source} on submit and renders the rows summary', async () => {
    const user = userEvent.setup();
    // NOTE: read the raw multipart body as text rather than `request.formData()`
    // — the undici bundled in the Node test runtime cannot re-parse the very
    // multipart body it generates for an outgoing `FormData` (a known undici
    // round-trip bug). Asserting on the raw body + Content-Type proves the
    // client sent multipart with the file under the `file` field, which is what
    // matters here. The real browser/backend parse it fine.
    let captured: { url: string; contentType: string; body: string } | null = null;
    server.use(
      http.post(`${apiBaseUrl}/api/v1/ingest/:source`, async ({ request, params }) => {
        captured = {
          url: request.url,
          contentType: request.headers.get('content-type') ?? '',
          body: await request.text(),
        };
        return HttpResponse.json({
          source: String(params.source),
          files: [{ filename: 'amex.csv', detected_type: 'amex', rows: 7 }],
          total_rows: 7,
        });
      }),
    );

    const onIngested = vi.fn();
    renderWithProviders(<UploadControl source="transactions" onIngested={onIngested} />);

    const file = new File(['Date,Description,Amount\n'], 'amex.csv', { type: 'text/csv' });
    await user.upload(fileInputFor(/choose files/i), file);
    await user.click(screen.getByRole('button', { name: /upload & ingest/i }));

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    // The request hit the right ingest path as multipart with the file in the
    // `file` field (asserted on the raw body, not via undici's broken parser).
    expect(captured).not.toBeNull();
    // (The exact filename in the serialized body is asserted in api.test.ts,
    // which inspects the FormData object directly; the Node test runtime's
    // undici rewrites the multipart filename to "blob", so here we assert the
    // path, the multipart Content-Type, and the `file` field name.)
    expect(captured!.url).toContain('/api/v1/ingest/transactions');
    expect(captured!.contentType).toMatch(/^multipart\/form-data; *boundary=/i);
    expect(captured!.body).toContain('name="file"');

    // Success renders the per-file detected type + the rows loaded.
    expect(screen.getByRole('status')).toHaveTextContent(/loaded 7 rows from 1 file/i);
    expect(screen.getByText(/amex\.csv — amex · 7 rows/i)).toBeInTheDocument();

    // It invalidates the affected dashboard data via the callback.
    expect(onIngested).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'transactions', total_rows: 7 }),
    );
  });

  it('renders the canonical error message on a 422', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${apiBaseUrl}/api/v1/ingest/:source`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: 'Could not detect a known bank format for the uploaded file.',
              details: [],
            },
          },
          { status: 422 },
        ),
      ),
    );

    renderWithProviders(<UploadControl source="transactions" />);
    const file = new File(['garbage'], 'mystery.csv', { type: 'text/csv' });
    await user.upload(fileInputFor(/choose files/i), file);
    await user.click(screen.getByRole('button', { name: /upload & ingest/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not detect a known bank format/i,
    );
  });

  it('accepts a dropped file via drag-and-drop', () => {
    renderWithProviders(<UploadControl source="holdings" />);
    const input = fileInputFor(/choose file$/i);
    // The drop zone is the dashed container around the picker.
    const dropZone = input.closest('div.border-dashed') as HTMLElement;

    const file = new File(['Symbol,Qty\n'], 'positions.csv', { type: 'text/csv' });
    const dataTransfer = { files: [file] };

    fireEvent.dragOver(dropZone, { dataTransfer });
    fireEvent.dragLeave(dropZone, { dataTransfer });
    fireEvent.drop(dropZone, { dataTransfer });

    expect(screen.getByText('positions.csv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload & ingest/i })).toBeEnabled();
  });

  it('lets the owner clear a selection before uploading', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UploadControl source="loans" />);

    const file = new File(['x'], 'loans.csv', { type: 'text/csv' });
    await user.upload(fileInputFor(/choose file$/i), file);
    expect(screen.getByText('loans.csv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload & ingest/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.queryByText('loans.csv')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload & ingest/i })).toBeDisabled();
  });
});
