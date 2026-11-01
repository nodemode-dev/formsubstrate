import sys

if sys.platform.startswith("linux"):
    try:
        import ctypes.util

        if hasattr(ctypes.util, "_findLib_ld"):
            ctypes.util._findLib_ld = lambda name: None
    except ImportError:
        pass

__version__ = "0.14.0"
