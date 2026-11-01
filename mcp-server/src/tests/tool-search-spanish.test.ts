import { describe, expect, it } from 'vitest';
import { searchTools } from '../tool-search.js';
import { allTools } from '../tools/index.js';

const CASES = [
  ['crear una escena', 'create_scene'], ['agregar un nodo', 'add_node'],
  ['leer una escena', 'read_scene'], ['renombrar un nodo', 'rename_node'],
  ['duplicar un nodo', 'duplicate_node'], ['conectar una señal', 'connect_signal'],
  ['adjuntar script a nodo', 'attach_script'], ['reiniciar el editor', 'restart_editor'],
  ['ejecutar escena', 'run_scene'], ['detener el juego', 'stop_scene'],
  ['validar scripts', 'validate_scripts'], ['buscar recursos sin usar', 'find_unused_resources'],
  ['comparar capturas', 'compare_screenshots'], ['exportar el proyecto', 'export_project'],
  ['crear animación de sprite', 'create_sprite_animation'], ['configurar iluminación', 'setup_lighting'],
  ['cambiar parámetro de shader', 'set_shader_param'], ['deshacer', 'undo_last'],
  ['rehacer', 'redo_last'], ['medir distancia entre nodos', 'measure_node_distance'],
] as const;

describe('Spanish tool discovery', () => {
  it('keeps the intended tools discoverable using common Spanish goals', () => {
    const ranks = CASES.map(([query, expected]) => {
      const found = searchTools(allTools, query, { limit: 10 });
      const index = found.findIndex(hit => hit.name === expected);
      return { query, expected, rank: index < 0 ? Infinity : index + 1 };
    });
    const top1 = ranks.filter(row => row.rank === 1).length;
    const top3 = ranks.filter(row => row.rank <= 3).length;
    console.log(`Spanish search: top1=${top1}/${ranks.length}, top3=${top3}/${ranks.length}`);
    expect(ranks.filter(row => row.rank > 3)).toEqual([]);
    expect(top1).toBeGreaterThanOrEqual(18);
  });
  it('does not overweight repeated terms', () => {
    const result = (query: string) => searchTools(allTools, query).map(hit => [hit.name, hit.score]);
    expect(result('read scene scene scene')).toEqual(result('read scene'));
    expect(result('crear escena escena')).toEqual(result('crear escena'));
  });
});
