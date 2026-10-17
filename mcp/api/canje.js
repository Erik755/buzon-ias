// Canje de código de configuración (bzc_) por token de agente (bz_). Usa solo la clave pública.
import { createClient } from '@supabase/supabase-js';
import { rpcSupabase } from '../lib/servicio.js';
import { crearCanje } from '../lib/canje.js';
let h;
export default function handler(req, res) { h ??= crearCanje(rpcSupabase(createClient)); return h(req, res); }
