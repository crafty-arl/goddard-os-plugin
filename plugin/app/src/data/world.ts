// The colony as data. The tile map is the truth; the renderer only draws it.
// Place names are plain function labels until Carl names them.

export const MAP_SIZE = 9

export type Tile = 'grass' | 'grass2' | 'path' | 'water'

export interface Place {
  id: string
  label: string
  cells: [number, number][]
  height: number // in tiles
  color: string
  // the tile an agent stands on when it works here
  stand: [number, number]
}

export const PLACES: Place[] = [
  { id: 'writing', label: 'Writing desk', cells: [[2, 2]], height: 0.55, color: '#E9DDC3', stand: [3, 2] },
  { id: 'research', label: 'Research shelf', cells: [[5, 1], [6, 1]], height: 1.05, color: '#9C6B3F', stand: [5, 2] },
  { id: 'picture', label: 'Picture bench', cells: [[7, 3]], height: 0.5, color: '#6F8FA0', stand: [6, 3] },
  { id: 'review', label: 'Review table', cells: [[4, 4]], height: 0.4, color: '#BD8430', stand: [4, 5] },
  { id: 'tangent', label: 'Tangent board', cells: [[1, 6]], height: 0.85, color: '#D98B6A', stand: [2, 6] },
  { id: 'play', label: 'Play corner', cells: [[5, 7]], height: 1.2, color: '#5B4B8A', stand: [4, 7] },
  // where agents go when their job is done or they have none: a low mat to nap on
  { id: 'nap', label: 'Nap spot', cells: [[7, 6]], height: 0.15, color: '#A9B6C6', stand: [6, 6] },
]

export const TREES: [number, number][] = [[0, 0], [1, 0], [8, 0], [0, 8], [0, 2], [8, 2], [3, 8], [2, 7]]

const PATH = new Set<string>([
  ...Array.from({ length: MAP_SIZE }, (_, x) => `${x},4`),
  ...Array.from({ length: MAP_SIZE }, (_, y) => `4,${y}`),
  '2,3', '6,2', '6,3', '7,5', '2,6', '6,6',
])
const WATER = new Set(['7,7', '8,7', '8,8', '7,8', '8,6'])

export function tileAt(x: number, y: number): Tile {
  const k = `${x},${y}`
  if (WATER.has(k)) return 'water'
  if (PATH.has(k)) return 'path'
  return (x * 3 + y * 5 + ((x * 7 + y * 11) % 3)) % 3 ? 'grass' : 'grass2'
}

export const placeById = (id: string) => PLACES.find(p => p.id === id)!
