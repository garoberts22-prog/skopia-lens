"""
ScheduleCheck - Parser Adapter Protocol

Defines the interface that all format-specific parsers must implement.
Each adapter reads its native format and produces a ScheduleModel.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO, Union

from core.models import ScheduleModel


class ParserAdapter(ABC):
    """
    Base class for schedule file parsers.
    
    Each adapter handles one input format (XER, MPP, XML, etc.)
    and normalises it into a ScheduleModel.
    """

    @property
    @abstractmethod
    def supported_extensions(self) -> list[str]:
        """File extensions this parser handles (e.g. ['.xer'])."""
        ...

    @property
    @abstractmethod
    def format_name(self) -> str:
        """Human-readable format name (e.g. 'Primavera XER')."""
        ...

    @abstractmethod
    def parse(
        self,
        file_path: Union[str, Path],
        filename: str = "",
    ) -> ScheduleModel:
        """
        Parse a schedule file and return a normalised ScheduleModel.
        
        Args:
            file_path: Path to the uploaded file on disk.
            filename: Original filename (for metadata/display).
            
        Returns:
            Populated ScheduleModel.
            
        Raises:
            ParseError: If the file cannot be parsed.
        """
        ...

    def can_handle(self, filename: str) -> bool:
        """Check if this parser can handle a file based on extension."""
        suffix = Path(filename).suffix.lower()
        return suffix in self.supported_extensions


class ParseError(Exception):
    """Raised when a schedule file cannot be parsed."""
    def __init__(self, message: str, format_name: str = "", details: str = ""):
        self.format_name = format_name
        self.details = details
        super().__init__(message)


def get_parser_for_file(filename: str, parsers: list[ParserAdapter]) -> ParserAdapter:
    """
    Select the appropriate parser based on file extension.
    
    Raises ParseError if no parser can handle the file.
    """
    for parser in parsers:
        if parser.can_handle(filename):
            return parser

    ext = Path(filename).suffix.lower()
    supported = []
    for p in parsers:
        supported.extend(p.supported_extensions)

    raise ParseError(
        f"Unsupported file format: {ext}",
        details=f"Supported formats: {', '.join(supported)}",
    )
