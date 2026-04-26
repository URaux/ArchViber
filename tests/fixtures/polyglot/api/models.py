"""Pydantic models for the API surface."""

from enum import Enum
from typing import Any, Dict
from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class JobRequest(BaseModel):
    payload: Dict[str, Any] = Field(default_factory=dict)
    priority: int = 0


class JobResponse(BaseModel):
    id: str
    status: JobStatus
