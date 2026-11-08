"""Takes the music out of a copy of The Question: its one track has no clear license.

    python3 -I demo/patch-the-question.py <copy of the_question>
"""
import pathlib
import sys

game = pathlib.Path(sys.argv[1]) / "game"


def replace(name, old, new):
    path = game / name
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        sys.exit(f"{name}: expected exactly one {old!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


replace("script.rpy", '    # Start by playing some music.\n    play music "illurock.opus"\n', "")
replace("options.rpy", "Music By: Alessio\n\n", "")
replace("options.rpy", "define config.has_music = True", "define config.has_music = False")
replace(
    "screens.rpy",
    '            hbox:\n                spacing 15\n                text _("Music By") style "about_small"\n'
    '                text _("Alessio")\n\n            null height 15\n\n',
    "",
)
for audio in list(game.rglob("*.opus")) + list(game.rglob("*.ogg")):
    audio.unlink()
print("The Question has no music now")
