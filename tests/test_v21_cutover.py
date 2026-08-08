from processor_app import _canonical_artifact_urls, app


def test_internal_profile_registry_is_available_through_json_composition():
    client = app.test_client()
    response = client.get('/internal/v1/rewrite/profiles')
    assert response.status_code == 200
    payload = response.get_json()
    names = {item['name'] for item in payload['profiles']}
    assert {'light', 'natural', 'rewrite_compress', 'compress', 'plain', 'expanded', 'conservative', 'balanced'} <= names


def test_artifact_urls_are_canonicalized_recursively():
    value = {
        'download_url': '/download/job/4_org_fin/final.docx',
        'nested': [
            {'preview_url': '/preview/job/turnitin/report.pdf'},
            '/api/documents/download/job/already.docx',
            'plain-value',
        ],
    }
    assert _canonical_artifact_urls(value) == {
        'download_url': '/api/documents/download/job/4_org_fin/final.docx',
        'nested': [
            {'preview_url': '/api/documents/preview/job/turnitin/report.pdf'},
            '/api/documents/download/job/already.docx',
            'plain-value',
        ],
    }
