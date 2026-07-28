extends Node
## send_input has to actually reach Input.is_action_*. Run as a SCENE, not with
## -s: the Input singleton only advances its action state on real frames, so a
## SceneTree script would prove nothing.
##
## Written because send_input was reported broken after a game-building session
## where a jump did not fire. It was not broken — the jump was being cancelled by
## floor snapping, and the input was arriving the whole time. This test exists so
## the next person suspecting send_input gets an answer in ten seconds instead of
## rewriting it.
##
## Exit 0 = every route delivers.

var _step := 0
var _failures: Array[String] = []

func _ready() -> void:
	if not InputMap.has_action(&"probe_act"):
		InputMap.add_action(&"probe_act")
		var ev := InputEventKey.new()
		ev.physical_keycode = KEY_SPACE
		InputMap.action_add_event(&"probe_act", ev)

func _process(_delta: float) -> void:
	_step += 1
	match _step:
		2:
			# Route A: an InputEventAction, which is what send_input sends for
			# {"type": "action"}.
			var a := InputEventAction.new()
			a.action = &"probe_act"
			a.pressed = true
			Input.parse_input_event(a)
		3:
			_expect("action event sets is_action_pressed", Input.is_action_pressed(&"probe_act"))
			_expect("action event sets is_action_just_pressed", Input.is_action_just_pressed(&"probe_act"))
			var a := InputEventAction.new()
			a.action = &"probe_act"
			a.pressed = false
			Input.parse_input_event(a)
		5:
			# Route B: a physical key, which is what send_input sends for
			# {"type": "key"} — and the route a game's own InputMap listens on.
			var k := InputEventKey.new()
			k.physical_keycode = KEY_SPACE
			k.pressed = true
			Input.parse_input_event(k)
		6:
			_expect("key event sets is_action_pressed", Input.is_action_pressed(&"probe_act"))
			_expect("key event sets is_action_just_pressed", Input.is_action_just_pressed(&"probe_act"))
			var k := InputEventKey.new()
			k.physical_keycode = KEY_SPACE
			k.pressed = false
			Input.parse_input_event(k)
		8:
			_expect("release clears is_action_pressed", not Input.is_action_pressed(&"probe_act"))
			print("=== INPUT: %d failure(s) ===" % _failures.size())
			for f in _failures:
				printerr("FAIL ", f)
			get_tree().quit(1 if _failures.size() > 0 else 0)

func _expect(what: String, condition: bool) -> void:
	if condition:
		print("  ok   ", what)
	else:
		_failures.append(what)
