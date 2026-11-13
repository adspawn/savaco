"""Carrier board placement (board-local mm, origin top-left, y down). All THT, top side."""
BOARD_W = 72.0
BOARD_H = 64.0
CORNER_R = 3.0

P = {
    # modules (origin = pin 1)
    "A1": (9.0, 4.5, 0),        # SuperMini, USB-C at the top edge
    "A2": (37.6, 4.5, 0),       # E220-EV2, SMA sticks out past the right edge
    "J3": (30.5, 4.5, 0),       # I2C header
    "C1": (29.0, 18.0, 0),
    "C2": (27.6, 23.6, 0),
    # button / LEDs
    "SW1": (4.0, 29.0, 0),
    "J1": (3.0, 41.2, 0),
    "R3": (20.0, 28.0, 0), "C3": (20.0, 32.0, 0), "R4": (20.0, 36.0, 0),
    "LED1": (31.0, 29.0, 0), "R5": (37.2, 29.0, 0),
    "LED2": (31.0, 36.0, 0), "R6": (37.2, 36.0, 0),
    # buzzer
    "BZ1": (50.2, 31.0, 0),
    "D1": (48.0, 39.6, 0),
    "Q1": (62.0, 40.0, 0),
    "R1": (48.0, 42.6, 0), "R7": (61.0, 44.0, 0),
    # 24 V siren
    "A3": (8.9, 52.0, 0),
    "C4": (43.6, 53.0, 0),
    "R2": (42.4, 46.6, 0), "R8": (42.4, 60.2, 0),
    "Q2": (52.0, 52.0, 0),
    "D2": (52.4, 60.2, 0),
    "J2": (65.0, 50.0, 0),
    # holes
    "H1": (3.5, 3.5, 0), "H2": (68.5, 27.0, 0), "H3": (3.5, 60.5, 0), "H4": (68.5, 60.5, 0),
}

# hand-placed silkscreen reference designators (board-local mm)
REF_POS = {"C1": (33.0, 14.2), "LED1": (37.2, 26.0)}
