import { memo } from 'react'

const n = (v, d = 1, unit = '') => (v == null ? null : `${Number(v).toFixed(d)}${unit}`)

/** Compact camera-metadata block shown under an uploaded image. */
function CameraInfo({ camera }) {
  if (!camera) return null
  if (!camera.available) {
    return <p className="muted small">No camera metadata (send original drone files, not WhatsApp copies).</p>
  }
  const rows = [
    ['Camera', camera.camera],
    ['Taken', camera.taken_at],
    ['Height above take-off', n(camera.relative_altitude_m, 1, ' m')],
    ['Altitude', n(camera.altitude_m, 1, ' m')],
    ['Gimbal pitch', n(camera.gimbal_pitch_deg, 1, '°')],
    ['Focal length', camera.focal_length_mm ? `${n(camera.focal_length_mm, 1, ' mm')}${camera.focal_length_35mm ? ` (${n(camera.focal_length_35mm, 0, ' mm eq.')})` : ''}` : null],
    ['GPS', camera.latitude != null && camera.longitude != null ? `${camera.latitude.toFixed(5)}, ${camera.longitude.toFixed(5)}` : null],
  ].filter(([, v]) => v)
  return (
    <table className="mini camera">
      <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
    </table>
  )
}

export default memo(CameraInfo)
