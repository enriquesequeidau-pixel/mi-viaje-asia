import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await Promise.all(['AsiaTripDB', 'AsiaTripPrivate'].map(name => new Promise(resolve => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    })));
  });
  await page.reload();
});

test('renders the complete itinerary without horizontal overflow', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Itinerario' })).toBeVisible();
  await expect(page.locator('.activity-row')).toHaveCount(140);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
});

test('works at mobile size and opens the accessible activity dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.activity-copy').first().click();
  await expect(page.locator('#app-dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.screenshot({ path: 'test-results/mobile-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-dialog')).not.toBeVisible();
});

test('user text is rendered as text and cannot execute HTML', async ({ page }) => {
  await page.getByRole('button', { name: 'Agregar evento' }).click();
  await page.getByLabel('Título').fill('<img src=x onerror="window.__xss=true">');
  await page.locator('#app-dialog').getByLabel('Fecha', { exact: true }).fill('2026-08-22');
  await page.locator('#app-dialog').getByLabel('Hora', { exact: true }).fill('10:00');
  await page.locator('#app-dialog').getByLabel('Ciudad', { exact: true }).fill('TEST');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByText('<img src=x onerror="window.__xss=true">')).toBeVisible();
  expect(await page.evaluate(() => window.__xss === true)).toBe(false);
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});

test('corrupted local storage cannot prevent startup', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('asiaTripState2026.v7', '{bad json'));
  await page.reload();
  await expect(page.locator('.activity-row').first()).toBeVisible();
});

test('v33 visibly invalidates stale cloud revision once', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('asiaTripCloudMeta2026.v1', JSON.stringify({ tripId: 'test-trip', revision: 999, schemaVersion: 7 })));
  await page.reload();
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('asiaTripCloudMeta2026.v1')));
  expect(meta.revision).toBe(0);
  expect(meta.schemaVersion).toBe(8);
  await page.getByRole('button', { name: 'Abrir herramientas' }).click();
  await expect(page.getByLabel('Versión de la vista')).toHaveText('Vista v33');
});

test('filters do not alter global progress', async ({ page }) => {
  const before = await page.locator('#progress-pill').textContent();
  await page.locator('.check-button').first().click();
  const afterCheck = await page.locator('#progress-pill').textContent();
  await page.getByLabel('Filtrar por ciudad').selectOption('TOKYO');
  expect(await page.locator('#progress-pill').textContent()).toBe(afterCheck);
  expect(afterCheck).not.toBe(before);
});

test('restores legacy activity photos and allows new uploads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('AsiaTripDB', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const request = db.transaction('photos', 'readwrite').objectStore('photos').add({
        activityId: 'flight-it-1',
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  });
  await page.reload();
  await page.locator('.activity-copy').first().click();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles('assets/icon-192.png');
  await expect(page.locator('.photo-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/photo-dialog.png', fullPage: false });
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.activity-copy').first().click();
  await expect(page.locator('.photo-card')).toHaveCount(2);
});

test('shows the original planned budget instead of doubling stays', async ({ page }) => {
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.locator('#app-dialog')).toContainText('1.620.340');
  await expect(page.locator('#app-dialog')).toContainText('801.760');
  await expect(page.locator('#app-dialog')).toContainText('181.080');
  await expect(page.locator('#app-dialog')).toContainText('637.500');
  await expect(page.locator('#app-dialog')).not.toContainText('Vuelos planificados');
});

test('keeps estimates separate and manages stays, transports and flights', async ({ page }) => {
  test.setTimeout(60_000);
  const dialog = page.locator('#app-dialog');
  await page.getByRole('button', { name: 'Abrir herramientas' }).click();
  await page.getByRole('button', { name: /Estadías/ }).click();
  await page.getByRole('button', { name: 'Reserva y gasto real' }).first().click();
  await expect(dialog.getByLabel('Costo real por persona (CLP)')).toHaveValue('');
  await page.getByRole('button', { name: 'Volver' }).click();

  await page.getByRole('button', { name: '+ Agregar estadía' }).click();
  await dialog.getByLabel('País').fill('Chile');
  await dialog.getByLabel('Ciudad', { exact: true }).fill('Pucón');
  await dialog.getByLabel('Check-in', { exact: true }).fill('2026-09-11T15:00');
  await dialog.getByLabel('Check-out', { exact: true }).fill('2026-09-13T11:00');
  await dialog.getByLabel('Noches').fill('2');
  await dialog.getByLabel('Estimado por persona (CLP)').fill('120000');
  await dialog.getByLabel('Zona o alojamiento previsto').fill('Centro');
  await page.getByRole('button', { name: 'Agregar estadía' }).click();
  const stayCard = page.locator('.record-card').filter({ hasText: 'PUCÓN' });
  await expect(stayCard).toContainText('120.000');
  await stayCard.getByRole('button', { name: 'Editar estimado' }).click();
  await dialog.getByLabel('Estimado por persona (CLP)').fill('130000');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.record-card').filter({ hasText: 'PUCÓN' })).toContainText('130.000');
  await page.locator('.record-card').filter({ hasText: 'PUCÓN' }).getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Eliminar estadía' }).click();
  await expect(page.locator('#app-dialog')).not.toContainText('PUCÓN');
  await page.locator('#dialog-close').click();

  await page.getByRole('button', { name: /Traslados/ }).click();
  await expect(page.locator('form.info-card')).toHaveCount(8);
  await page.getByRole('button', { name: '+ Agregar traslado' }).click();
  await dialog.getByLabel('Título').fill('Tren de prueba');
  await dialog.getByLabel('Fecha', { exact: true }).fill('2026-09-12');
  await dialog.getByLabel('Hora', { exact: true }).fill('08:30');
  await dialog.getByLabel('Ciudad', { exact: true }).fill('Tokyo');
  await dialog.getByLabel('Medio').fill('Tren');
  await dialog.getByLabel('Origen').fill('Tokyo');
  await dialog.getByLabel('Destino').fill('Narita');
  await dialog.getByLabel('Costo estimado por persona (CLP)').fill('25000');
  await page.getByRole('button', { name: 'Agregar traslado' }).click();
  const transportCard = page.locator('form.info-card').filter({ hasText: 'Tren de prueba' });
  await expect(transportCard).toContainText('25.000');
  await transportCard.getByRole('button', { name: 'Editar estimado' }).click();
  await dialog.getByLabel('Costo estimado por persona (CLP)').fill('27000');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('form.info-card').filter({ hasText: 'Tren de prueba' })).toContainText('27.000');
  await page.locator('form.info-card').filter({ hasText: 'Tren de prueba' }).getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Eliminar traslado' }).click();
  await expect(page.locator('#app-dialog')).not.toContainText('Tren de prueba');
  await page.locator('#dialog-close').click();

  await page.getByRole('button', { name: /Vuelos/ }).click();
  await expect(dialog).toContainText('Esta vista está sin sesión');
  await page.getByRole('button', { name: '+ Agregar vuelo' }).click();
  await dialog.getByLabel('Origen', { exact: true }).fill('Tokio');
  await dialog.getByLabel('Código origen').fill('HND');
  await dialog.getByLabel('Destino', { exact: true }).fill('Sapporo');
  await dialog.getByLabel('Código destino').fill('CTS');
  await dialog.getByLabel('Fecha', { exact: true }).fill('2026-09-12');
  await dialog.getByLabel('Hora', { exact: true }).fill('10:00');
  await dialog.getByLabel('Aerolínea').fill('ANA');
  await dialog.getByLabel('Número de vuelo').fill('NH99');
  await page.getByRole('button', { name: 'Agregar vuelo' }).click();
  const flightCard = page.locator('.record-card').filter({ hasText: 'HND → CTS' });
  await expect(flightCard).toContainText('Costo real pendiente');
  await flightCard.getByRole('button', { name: 'Reserva y costo real' }).click();
  await dialog.getByLabel('Código de reserva').fill('TEST123');
  await dialog.getByLabel('Reserva confirmada').selectOption('Sí');
  await dialog.getByLabel('Costo real (CLP)').fill('90000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(flightCard).toContainText('Costo real: $90.000');
  await expect(flightCard).toContainText('Reserva TEST123 · Confirmada');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/management-mobile.png', fullPage: false });
  await flightCard.getByRole('button', { name: 'Editar vuelo' }).click();
  await dialog.getByLabel('Número de vuelo').fill('NH100');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.record-card').filter({ hasText: 'HND → CTS' })).toContainText('NH100');
  await page.locator('.record-card').filter({ hasText: 'HND → CTS' }).getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Eliminar vuelo' }).click();
  await expect(page.locator('#app-dialog')).not.toContainText('HND → CTS');

  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('asiaTripOutbox2026.v1')));
  expect(queued.some(item => item.item_type === 'stay' && item.deleted)).toBe(true);
  expect(queued.some(item => item.item_type === 'activity' && item.deleted)).toBe(true);
  expect(queued.some(item => item.item_type === 'flight' && item.deleted)).toBe(true);
  expect(queued.some(item => item.item_type === 'stay_detail' && item.deleted)).toBe(true);
  expect(queued.some(item => item.item_type === 'transport_cost' && item.deleted)).toBe(true);
  expect(queued.some(item => item.item_type === 'flight_detail' && item.deleted)).toBe(true);
});

test('loads without runtime, CSP or missing-asset errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});
