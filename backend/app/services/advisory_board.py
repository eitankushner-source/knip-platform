from datetime import datetime, timezone
from typing import Any

from app.models import AdvisorRecommendation, AdvisoryConsensus, NormalizedStory


ADVISOR_DEFINITIONS = [
    {'advisorId': 'ruby', 'advisorName': 'Ruby', 'role': 'Chief Strategy Officer', 'perspectiveLabel': 'Strategic Opportunity'},
    {'advisorId': 'shani', 'advisorName': 'Shani', 'role': 'Chief Knowledge Officer', 'perspectiveLabel': 'Evidence & Knowledge'},
    {'advisorId': 'amit', 'advisorName': 'Amit', 'role': 'Chief Operations Officer', 'perspectiveLabel': 'Operations Readiness'},
    {'advisorId': 'cta', 'advisorName': 'CTA', 'role': 'Chief Technology Architect', 'perspectiveLabel': 'Technology & Confidence'},
    {'advisorId': 'devils-advocate', 'advisorName': 'Devil’s Advocate', 'role': 'AI Skeptic', 'perspectiveLabel': 'Risk & Alternative View'},
]


def _clamp(value: float, lower: float = 0.0, upper: float = 100.0) -> float:
    return max(lower, min(upper, value))


def _source_mode(story: NormalizedStory | None, fallback: bool = False) -> str:
    if fallback or not story:
        return 'FALLBACK'
    if getattr(story, 'eligibleForExecutiveUse', False) and getattr(story, 'sourceUrl', None):
        return 'LIVE'
    return 'RULE_BASED'


def _connector_health(connector: str | None) -> int:
    if connector in {'GDELT DOC 2.0', 'Curated RSS', 'KNIP Research Agents'}:
        return 88
    if connector in {'Local Story Repository'}:
        return 74
    return 70


def _build_evidence(story: NormalizedStory | None) -> list[str]:
    if not story:
        return ['Fallback story used because no eligible live priority is available.']
    evidence = [
        f"Relevance score: {int(round(story.relevanceScore))}",
        f"Evidence quality: {int(round(story.evidenceQuality))}",
        f"Authenticity score: {int(round(story.authenticityScore))}",
    ]
    if story.bestAudienceMatch:
        evidence.append(f"Best audience: {story.bestAudienceMatch.audienceName} ({int(round(story.bestAudienceMatch.matchScore))})")
    if story.geography:
        evidence.append(f"Geography: {', '.join(story.geography)}")
    evidence.append(f"Provenance: {story.sourceName} ({story.connector})")
    return evidence


def _build_assumptions(story: NormalizedStory | None) -> list[str]:
    if not story:
        return ['No live eligible story was available, so the fallback board assumes a broadly relevant human-impact narrative.']
    return [
        'Recommendation is derived from the available story metrics and audience-match signals.',
        'The board does not claim certainty beyond current evidence quality and provenance.',
    ]


def build_advisory_board(story: NormalizedStory | None = None, source_mode: str | None = None) -> tuple[list[AdvisorRecommendation], AdvisoryConsensus, str, str]:
    mode = source_mode or _source_mode(story)
    fallback = mode == 'FALLBACK'
    story_title = story.title if story else 'the current priority story'
    story_summary = story.summary if story else 'A fallback advisory board recommendation is used when no eligible live story is available.'

    relevance_score = int(round(story.relevanceScore)) if story else 70
    evidence_quality = int(round(story.evidenceQuality)) if story else 78
    authenticity_score = int(round(story.authenticityScore)) if story else 82
    freshness_score = int(round(story.freshness)) if story else 72
    source_reliability = int(round(story.sourceReliability)) if story else 78
    audience_match_score = int(round(story.audienceMatchScore)) if story and story.bestAudienceMatch else 80
    audience_confidence = int(round(story.bestAudienceMatch.confidence)) if story and story.bestAudienceMatch else 74
    audience_name = story.bestAudienceMatch.audienceName if story and story.bestAudienceMatch else 'Moderate Democrats'
    audience_data_mode = story.audienceDataMode if story else 'RULE_BASED'
    geography = ', '.join(story.geography) if story and story.geography else 'United States'
    connector_health = _connector_health(story.connector if story else None)
    strategic_label = story.strategicRelevanceLabel if story else 'humanitarian activity'

    ruby_recommendation = 'APPROVE' if relevance_score >= 80 and audience_match_score >= 75 else 'MODIFY' if relevance_score >= 70 else 'DELAY'
    ruby_confidence = int(_clamp((relevance_score * 0.3) + (audience_match_score * 0.25) + (freshness_score * 0.15) + (evidence_quality * 0.15) + (source_reliability * 0.15)))
    ruby = AdvisorRecommendation(
        advisorId='ruby',
        advisorName='Ruby',
        role='Chief Strategy Officer',
        recommendation=ruby_recommendation,
        headline=f"Frame {story_title.lower()} as a decision-ready strategic opportunity.",
        reasoning='The story has a strong strategic fit when relevance, audience resonance, and timing all point in the same direction.',
        evidence=_build_evidence(story),
        risks=['The message should stay human-centered and avoid over-claiming impact.'] if not fallback else ['Fallback guidance should be validated against the next live story.'],
        assumptions=_build_assumptions(story),
        confidence=float(ruby_confidence),
        perspectiveLabel='Strategic Opportunity',
        direction='UP' if ruby_recommendation in {'APPROVE', 'MODIFY'} else 'DOWN',
        generatedAt=datetime.now(timezone.utc),
        sourceMode=mode,
    )

    shani_recommendation = 'APPROVE' if evidence_quality >= 80 and source_reliability >= 80 and authenticity_score >= 80 else 'MODIFY' if evidence_quality >= 70 else 'DELAY'
    shani_confidence = int(_clamp((evidence_quality * 0.35) + (authenticity_score * 0.25) + (source_reliability * 0.2) + (connector_health * 0.2)))
    shani = AdvisorRecommendation(
        advisorId='shani',
        advisorName='Shani',
        role='Chief Knowledge Officer',
        recommendation=shani_recommendation,
        headline=f"Treat {story_title.lower()} as evidence-forward but verify the provenance trail.",
        reasoning='The available evidence is useful, but the knowledge board should check source provenance and unresolved gaps before activation.',
        evidence=_build_evidence(story),
        risks=['A weak provenance trail or missing corroboration would reduce confidence.'] if not fallback else ['Fallback guidance should be revisited once fresh evidence is available.'],
        assumptions=_build_assumptions(story),
        confidence=float(shani_confidence),
        perspectiveLabel='Evidence & Knowledge',
        direction='UP' if shani_recommendation in {'APPROVE', 'MODIFY'} else 'DOWN',
        generatedAt=datetime.now(timezone.utc),
        sourceMode=mode,
    )

    amit_recommendation = 'APPROVE' if freshness_score >= 80 and relevance_score >= 78 and source_reliability >= 78 else 'MODIFY' if freshness_score >= 70 else 'DELAY'
    amit_confidence = int(_clamp((freshness_score * 0.3) + (source_reliability * 0.25) + (relevance_score * 0.2) + (evidence_quality * 0.15) + (connector_health * 0.1)))
    amit = AdvisorRecommendation(
        advisorId='amit',
        advisorName='Amit',
        role='Chief Operations Officer',
        recommendation=amit_recommendation,
        headline=f"Prepare a fast operational sprint for {story_title.lower()} if dependencies are confirmed.",
        reasoning='Operations readiness depends on timing, partner coordination, and the ability to package the story quickly.',
        evidence=_build_evidence(story),
        risks=['Execution could slow if partner approvals or content dependencies are not ready.'] if not fallback else ['Fallback guidance should be replaced by a live execution plan once a story is qualified.'],
        assumptions=_build_assumptions(story),
        confidence=float(amit_confidence),
        perspectiveLabel='Operations Readiness',
        direction='UP' if amit_recommendation in {'APPROVE', 'MODIFY'} else 'DOWN',
        generatedAt=datetime.now(timezone.utc),
        sourceMode=mode,
    )

    cta_recommendation = 'MONITOR' if audience_data_mode != 'LIVE' or connector_health < 80 else 'APPROVE' if evidence_quality >= 80 and audience_confidence >= 75 else 'MODIFY'
    cta_confidence = int(_clamp((audience_confidence * 0.3) + (connector_health * 0.3) + (evidence_quality * 0.25) + (source_reliability * 0.15)))
    cta = AdvisorRecommendation(
        advisorId='cta',
        advisorName='CTA',
        role='Chief Technology Architect',
        recommendation=cta_recommendation,
        headline=f"Monitor the evidence stack for {story_title.lower()} until the data completeness and connector signals are stable.",
        reasoning='The recommendation is shaped by connector health, audience confidence, and whether the data pipeline is complete enough for monitoring.',
        evidence=[f"Audience confidence: {audience_confidence}", f"Audience data mode: {audience_data_mode}", f"Connector health: {connector_health}", f"Geography: {geography}"],
        risks=['Sparse geographies or partial evidence will lower monitoring confidence.'] if not fallback else ['Fallback guidance should not be treated as a production-grade monitoring signal.'],
        assumptions=_build_assumptions(story),
        confidence=float(cta_confidence),
        perspectiveLabel='Technology & Confidence',
        direction='NEUTRAL' if cta_recommendation == 'MONITOR' else 'UP',
        generatedAt=datetime.now(timezone.utc),
        sourceMode=mode,
    )

    devil_recommendation = 'DELAY' if ruby_recommendation in {'APPROVE', 'MODIFY'} else 'REJECT'
    devil_confidence = int(_clamp((evidence_quality * 0.25) + (source_reliability * 0.2) + (freshness_score * 0.2) + (audience_confidence * 0.15) + (connector_health * 0.2)))
    devil = AdvisorRecommendation(
        advisorId='devils-advocate',
        advisorName='Devil’s Advocate',
        role='AI Skeptic',
        recommendation=devil_recommendation,
        headline=f"Challenge {story_title.lower()} until the risk frame and alternative explanation are clear.",
        reasoning='The story could be short-lived, over-indexed on a single source, or less relevant than the current audience framing suggests.',
        evidence=[f"Strategic relevance: {strategic_label}", f"Source reliability: {source_reliability}", f"Audience match: {audience_match_score}"],
        risks=['The news cycle may move faster than the evidence can be corroborated.', 'The story may be interpreted as political or overly promotional.'],
        assumptions=[
            'The board assumes the available evidence is the best snapshot of the moment.',
            'The board does not assume the story will remain relevant beyond the current cycle.',
        ],
        confidence=float(devil_confidence),
        perspectiveLabel='Risk & Alternative View',
        direction='DOWN',
        generatedAt=datetime.now(timezone.utc),
        sourceMode=mode,
    )

    advisors = [ruby, shani, amit, cta, devil]

    recommendation_votes: dict[str, int] = {}
    for item in advisors:
        recommendation_votes[item.recommendation] = recommendation_votes.get(item.recommendation, 0) + 1
    top_recommendation = max(recommendation_votes.items(), key=lambda item: (item[1], item[0]))[0]
    consensus_recommendation = 'MODIFY' if top_recommendation in {'APPROVE', 'MODIFY'} and recommendation_votes.get('MODIFY', 0) >= 2 else top_recommendation
    consensus_recommendation = 'DELAY' if consensus_recommendation == 'APPROVE' and recommendation_votes.get('DELAY', 0) >= 2 else consensus_recommendation
    if consensus_recommendation not in {'APPROVE', 'MODIFY', 'DELAY', 'REJECT', 'MONITOR'}:
        consensus_recommendation = 'MONITOR'

    agreement_count = recommendation_votes.get(consensus_recommendation, 0)
    dissent_count = len(advisors) - agreement_count
    majority_reason = 'The board sees meaningful strategic value but still wants evidence and operational safeguards.'
    if consensus_recommendation in {'APPROVE', 'MODIFY'}:
        majority_reason = 'The majority sees a credible opportunity with sufficient audience and evidence support to proceed with safeguards.'
    elif consensus_recommendation == 'DELAY':
        majority_reason = 'The majority wants more evidence quality and a cleaner source trail before full activation.'
    elif consensus_recommendation == 'MONITOR':
        majority_reason = 'The majority prefers to monitor the data quality and connector health before expanding the recommendation.'
    else:
        majority_reason = 'The majority sees too much uncertainty or alternative interpretation to move forward.'

    minority_opinion = 'No strong dissent was identified.' if devil.recommendation == consensus_recommendation else devil.headline
    unresolved_questions = [
        'What additional evidence would raise confidence above the current threshold?',
        'Is the story likely to remain relevant beyond the current news cycle?',
    ]
    if mode == 'RULE_BASED':
        unresolved_questions.append('How would the recommendation change if the audience data became fully live?')
    if fallback:
        unresolved_questions.append('Which next live story should be evaluated once the pipeline produces an eligible priority?')

    decision_readiness = 'READY' if consensus_recommendation in {'APPROVE', 'MODIFY'} and evidence_quality >= 78 else 'CONDITIONAL' if consensus_recommendation in {'MODIFY', 'MONITOR'} else 'HOLD'
    consensus = AdvisoryConsensus(
        consensusRecommendation=consensus_recommendation,
        consensusConfidence=float(_clamp((sum(item.confidence for item in advisors) / len(advisors)) - (dissent_count * 2.5))),
        agreementCount=agreement_count,
        dissentCount=dissent_count,
        majorityReason=majority_reason,
        minorityOpinion=minority_opinion,
        unresolvedQuestions=unresolved_questions,
        decisionReadiness=decision_readiness,
        generatedAt=datetime.now(timezone.utc),
        sourceMode=mode,
    )
    return advisors, consensus, minority_opinion, decision_readiness


def challenge_advisory_board(challenge: str, story: NormalizedStory | None = None, source_mode: str | None = None) -> dict[str, Any]:
    mode = source_mode or _source_mode(story)
    challenge_lower = (challenge or '').lower()
    if any(term in challenge_lower for term in ['risk', 'reputational', 'delay', 'evidence', 'uncertain']):
        recommendation = 'MODIFY'
    elif any(term in challenge_lower for term in ['monitor', 'data', 'connector']):
        recommendation = 'MONITOR'
    else:
        recommendation = 'DELAY'

    adjusted_confidence = max(40, min(90, 72 - (len(challenge.split()) // 6)))
    return {
        'challenge': challenge,
        'revisedRecommendation': recommendation,
        'adjustedConfidence': adjusted_confidence,
        'reasons': [
            'The challenge increases caution around evidence quality and risk framing.',
            'The revised recommendation lowers confidence because the board is treating the challenge as a requirement to re-evaluate the story.',
        ],
        'sourceMode': mode,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
    }
