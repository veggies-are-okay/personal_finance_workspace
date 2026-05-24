import { HealthResponseDto } from './health-response.dto';

describe('HealthResponseDto', () => {
  it('holds the status field and serializes to the canonical body', () => {
    const dto = new HealthResponseDto();
    dto.status = 'ok';

    expect(dto.status).toBe('ok');
    // Byte-for-byte match with the FastAPI HealthResponse serialization.
    expect(JSON.stringify(dto)).toBe('{"status":"ok"}');
  });
});
