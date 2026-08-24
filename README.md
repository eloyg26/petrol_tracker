# Gasolina Coruña

Servicio web para consultar gasolineras de la provincia de A Coruña, ver comparación frente a días anteriores y recibir un resumen diario por email.

## Funcionalidades

- Consulta en tiempo real a la API pública del Ministerio: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/
- Filtro de estaciones de la provincia de A Coruña
- Media de gasolina 95 y diésel con subida/bajada respecto al día anterior
- Lista de las estaciones más baratas
- Suscripción para recibir resumen diario por correo
- Panel con noticias sobre petróleo y gasolina

## Estructura

- app.py: servidor Flask y lógica del servicio
- templates/index.html: interfaz sencilla
- static/styles.css: estilos
- static/app.js: carga de datos y suscripción
- data/: historial y suscripciones

## Inicio rápido

1. Instala Python 3.12+.
2. Crea un entorno virtual:

   python -m venv .venv
   .venv\Scripts\activate

3. Instala dependencias:

   pip install -r requirements.txt

4. Ejecuta la app:

   python app.py

5. Abre http://localhost:5000

## Variables de entorno opcionales para email

Si quieres que el resumen diario se envíe realmente por email, configura estas variables:

- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASSWORD

## Nota importante

La app ya está diseñada para ejecutarse con una suscripción diaria y un panel con precios actuales. En este entorno la instalación de Python queda bloqueada por directiva de grupo del sistema, así que la validación final de arranque no pudo completarse aquí.
