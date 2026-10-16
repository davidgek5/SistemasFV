/** Mapa de selección de ubicación (Leaflet + OpenStreetMap). Clic o arrastre del marcador. */
import { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function Clic({ onElegir }: { onElegir: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onElegir(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Centrar({ lat, lon }: { lat: number; lon: number }) {
  const mapa = useMap();
  useEffect(() => {
    if (!mapa.getBounds().contains([lat, lon])) mapa.setView([lat, lon]);
  }, [lat, lon, mapa]);
  return null;
}

export default function Mapa({ lat, lon, onElegir }: { lat: number; lon: number; onElegir: (lat: number, lon: number) => void }) {
  return (
    <MapContainer center={[lat, lon]} zoom={9} scrollWheelZoom className="h-72 w-full rounded-xl sm:h-96">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <CircleMarker center={[lat, lon]} radius={9} pathOptions={{ color: '#b45309', fillColor: '#f59e0b', fillOpacity: 0.9, weight: 2 }} />
      <Clic onElegir={onElegir} />
      <Centrar lat={lat} lon={lon} />
    </MapContainer>
  );
}
