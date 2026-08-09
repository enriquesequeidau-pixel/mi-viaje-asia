# Mi Viaje Asia 2026

PWA privada para gestionar itinerario, vuelos, estadías, gastos y documentos del viaje. Funciona offline por defecto; Supabase es opcional para sincronizar un viaje entre dos cuentas.

## Desarrollo

```bash
npm ci
npm run build
npm run dev
```

Abre `http://localhost:4173`. Ejecuta `npm test` para las pruebas unitarias y `npm run test:e2e` para las pruebas de navegador (requiere `npx playwright install chromium`).

Los bundles e iconos generados se guardan en `assets/`. Las dependencias están fijadas y `package-lock.json` debe permanecer versionado.

## Sincronización en la nube

Este checkout ya está conectado al proyecto Supabase de producción mediante `config.js` y una clave pública moderna. Las migraciones de `supabase/migrations/` están aplicadas; conservan los datos heredados, separan las RPC privilegiadas del esquema expuesto y activan RLS, permisos explícitos, límite de dos miembros, protección del código de unión y el bucket privado `trip-media`.

Para instalar la aplicación en otro proyecto:

1. Crea o enlaza un proyecto Supabase.
2. Aplica `supabase/migrations/` con `npx supabase db push`.
3. Copia `config.example.js` sobre `config.js` y configura la URL y una clave **publicable** (`sb_publishable_…`) o la clave `anon` heredada.
4. Configura las URLs permitidas de Auth para el dominio final.

No uses una secret key ni `service_role` en archivos servidos al navegador.

## Privacidad y recuperación

- Los datos operativos se conservan en el navegador y pueden borrarse al cerrar sesión.
- Las fotos de actividades siguen usando el IndexedDB histórico `AsiaTripDB`, por lo que una actualización no elimina las imágenes existentes. Con una sesión activa también se copian al bucket privado del viaje.
- Los documentos se cifran con AES-256-GCM antes de guardarse localmente y no se sincronizan.
- Los respaldos se cifran con una clave elegida por el usuario. Esa clave no se puede recuperar.
- La caché offline contiene solo el shell público de la aplicación; nunca intercepta peticiones a Supabase.

Antes de publicar en otro entorno: prueba dos usuarios y revisa los asesores de seguridad/rendimiento de Supabase.
