"""Async SQLAlchemy session helpers."""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_SessionMaker = async_sessionmaker(_engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with _SessionMaker() as session:
        yield session


async def shutdown_engine() -> None:
    await _engine.dispose()
